import { useKeroPet } from './hooks/useKeroPet';

export default function App() {
  const { spriteStyle, containerStyle, onTap } = useKeroPet();
  return (
    <main
      className="pet-stage"
      onClick={onTap}
      style={containerStyle}
    >
      <div className="pet-sprite" style={spriteStyle} aria-label="Kero desktop pet" />
    </main>
  );
}
