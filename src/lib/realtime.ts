/// <reference types="vite/client" />

export type Lang = 'en' | 'es';

export interface RealtimeSession {
  value: string; // ephemeral client secret (ek_...)
  expires_at?: number;
}

const SESSION_URL = import.meta.env.VITE_SESSION_URL ?? 'http://127.0.0.1:8787';

/**
 * The single seam for obtaining a Realtime session. Phase 1 hits the local
 * Express server; Phase 2 only changes VITE_SESSION_URL to the deployed host.
 */
export async function getRealtimeSession(
  lang: Lang,
  sel: { model: string; voice: string },
): Promise<RealtimeSession> {
  const res = await fetch(`${SESSION_URL}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lang, model: sel.model, voice: sel.voice }),
  });
  if (!res.ok) {
    throw new Error(`session request failed: ${res.status}`);
  }
  return (await res.json()) as RealtimeSession;
}

export type RealtimeUiEvent =
  | { kind: 'user_transcript'; text: string }
  | { kind: 'kero_delta'; text: string }
  | { kind: 'kero_done'; text: string }
  | { kind: 'kero_speaking_start' }
  | { kind: 'kero_speaking_done' }
  | { kind: 'error'; message: string }
  | { kind: 'other' };

/** Pure normaliser for Realtime data-channel server events. */
export function parseRealtimeEvent(raw: { type?: string; [k: string]: unknown }): RealtimeUiEvent {
  switch (raw.type) {
    case 'conversation.item.input_audio_transcription.completed':
      return { kind: 'user_transcript', text: String(raw.transcript ?? '') };
    case 'response.audio_transcript.delta':
    case 'response.output_audio_transcript.delta':
      return { kind: 'kero_delta', text: String(raw.delta ?? '') };
    case 'response.audio_transcript.done':
    case 'response.output_audio_transcript.done':
      return { kind: 'kero_done', text: String(raw.transcript ?? '') };
    case 'response.created':
      return { kind: 'kero_speaking_start' };
    case 'response.done':
      return { kind: 'kero_speaking_done' };
    case 'error': {
      const error = raw.error as { message?: string } | undefined;
      return { kind: 'error', message: error?.message ?? 'realtime error' };
    }
    default:
      return { kind: 'other' };
  }
}

const CALLS_URL = 'https://api.openai.com/v1/realtime/calls';

// Push-to-talk needs a minimum hold before we treat it as real speech. A quick
// tap (press + release without speaking) would otherwise commit a near-empty
// buffer and make Kero respond to silence. The Realtime API also rejects a
// commit under ~100ms of audio, so this doubles as a guard against that error.
const MIN_TALK_MS = 300;

// Loudness gate: if the loudest moment while the button was held stays below
// this RMS (on getUserMedia's normalised [-1,1] samples), the press is treated
// as silence and dropped — this is what catches "held the button but never
// spoke". Raise it to require louder speech (fewer false triggers, but soft
// speech may be missed); lower it to pick up quiet speech (but more room noise
// leaks through). This is the tunable "sensitivity".
const SPEECH_RMS_THRESHOLD = 0.015;
// How often to sample loudness while talking.
const RMS_SAMPLE_MS = 50;

export interface RealtimeConnection {
  /** Enable the mic track (push-to-talk down). */
  startTalking: () => void;
  /** Disable the mic track and ask the model to respond (push-to-talk up). */
  stopTalking: () => void;
  /** Tear down the peer connection and mic. */
  disconnect: () => void;
}

export interface ConnectOptions {
  session: RealtimeSession;
  remoteAudio: HTMLAudioElement;
  onEvent: (event: RealtimeUiEvent) => void;
  /**
   * The realtime model to connect with. MUST match the model the ephemeral
   * session was minted with — OpenAI rejects the SDP call otherwise
   * ("Model X does not match the realtime token model").
   */
  model: string;
  /** Optional: send an initial response.create so Kero greets first. */
  greet?: boolean;
}

export async function connectRealtime(opts: ConnectOptions): Promise<RealtimeConnection> {
  const pc = new RTCPeerConnection();

  // Remote audio (Kero's voice)
  pc.ontrack = (e) => {
    opts.remoteAudio.srcObject = e.streams[0];
  };

  // Local mic — added but muted until push-to-talk. Clean up the peer
  // connection if the mic can't be acquired (e.g. permission denied).
  let mic: MediaStream;
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    pc.close();
    throw err;
  }
  const micTrack = mic.getAudioTracks()[0];
  if (!micTrack) {
    mic.getTracks().forEach((t) => t.stop());
    pc.close();
    throw new Error('No audio track available from getUserMedia');
  }
  micTrack.enabled = false;
  pc.addTrack(micTrack, mic);

  // Loudness metering for the push-to-talk speech gate. The AnalyserNode reads
  // the raw mic (independent of micTrack.enabled, which only gates what WebRTC
  // sends). We sample only while the button is held and remember the peak RMS.
  const audioCtx = new AudioContext();
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  audioCtx.createMediaStreamSource(mic).connect(analyser);
  const rmsFrame = new Float32Array(analyser.fftSize);
  let peakRms = 0;
  let rmsTimer: ReturnType<typeof setInterval> | null = null;
  const sampleRms = () => {
    analyser.getFloatTimeDomainData(rmsFrame);
    let sumSquares = 0;
    for (let i = 0; i < rmsFrame.length; i++) sumSquares += rmsFrame[i] * rmsFrame[i];
    const rms = Math.sqrt(sumSquares / rmsFrame.length);
    if (rms > peakRms) peakRms = rms;
  };
  const stopSampling = () => {
    if (rmsTimer !== null) { clearInterval(rmsTimer); rmsTimer = null; }
  };

  // Data channel for events (both directions)
  const dc = pc.createDataChannel('oai-events');
  const send = (msg: unknown) => {
    if (dc.readyState === 'open') dc.send(JSON.stringify(msg));
  };
  dc.onmessage = (e) => {
    try {
      opts.onEvent(parseRealtimeEvent(JSON.parse(e.data)));
    } catch {
      /* ignore malformed frames */
    }
  };
  dc.onopen = () => {
    if (opts.greet) send({ type: 'response.create' });
  };

  // SDP offer/answer with OpenAI using the ephemeral key as bearer.
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const sdpRes = await fetch(`${CALLS_URL}?model=${encodeURIComponent(opts.model)}`, {
    method: 'POST',
    body: offer.sdp,
    headers: {
      Authorization: `Bearer ${opts.session.value}`,
      'Content-Type': 'application/sdp',
    },
  });
  if (!sdpRes.ok) {
    const detail = await sdpRes.text().catch(() => '');
    pc.close();
    micTrack.stop();
    throw new Error(`realtime connect failed: ${sdpRes.status} ${detail}`);
  }
  await pc.setRemoteDescription({ type: 'answer', sdp: await sdpRes.text() });

  let talkStartedAt = 0;
  return {
    startTalking: () => {
      micTrack.enabled = true;
      talkStartedAt = performance.now();
      peakRms = 0;
      void audioCtx.resume();
      rmsTimer = setInterval(sampleRms, RMS_SAMPLE_MS);
    },
    stopTalking: () => {
      // Assumes push-to-talk: the session is configured with turn_detection=null,
      // so we manually commit the buffer and request a response here.
      micTrack.enabled = false;
      stopSampling();
      // Drop the buffer (no response) when the press was too brief to be speech
      // OR never got loud enough — i.e. a tap, or holding the button silently.
      const heldMs = performance.now() - talkStartedAt;
      if (heldMs < MIN_TALK_MS || peakRms < SPEECH_RMS_THRESHOLD) {
        send({ type: 'input_audio_buffer.clear' });
        return;
      }
      send({ type: 'input_audio_buffer.commit' });
      send({ type: 'response.create' });
    },
    disconnect: () => {
      stopSampling();
      void audioCtx.close();
      micTrack.stop();
      pc.close();
    },
  };
}
