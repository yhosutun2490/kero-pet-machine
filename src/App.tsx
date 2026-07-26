import { useKeroPet } from './hooks/useKeroPet';
import { PET_WINDOW_WIDTH, PET_WINDOW_HEIGHT } from './machines/keroMachine';

export default function App() {
  const { spriteStyle, onTap } = useKeroPet();
  return (
    <main
      className="pet-stage"
      onClick={onTap}
      style={{ width: PET_WINDOW_WIDTH, height: PET_WINDOW_HEIGHT }}
    >
      <div className="pet-sprite" style={spriteStyle} aria-label="Kero desktop pet" />
    </main>
  );
}
