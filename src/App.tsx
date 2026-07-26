import { useKeroPet } from './hooks/useKeroPet';

export default function App() {
  const { spriteStyle, containerStyle, onTap, onPointerDown } = useKeroPet();
  return (
    <main
      className="pet-stage"
      onClick={onTap}
      onPointerDown={onPointerDown}
      style={containerStyle}
    >
      <div className="pet-sprite" style={spriteStyle} aria-label="Kero desktop pet" />
    </main>
  );
}
