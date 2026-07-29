import { useKeroPet } from './hooks/useKeroPet';

export default function App() {
  const { spriteStyle, containerStyle, onTap, onPointerDown, onContextMenu } = useKeroPet();
  return (
    <main
      className="pet-stage"
      onClick={onTap}
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}
      style={containerStyle}
    >
      <div className="pet-sprite" style={spriteStyle} aria-label="Kero desktop pet" />
    </main>
  );
}
