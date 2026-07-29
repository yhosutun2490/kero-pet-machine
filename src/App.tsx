import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useKeroPet } from './hooks/useKeroPet';

interface MenuPosition {
  x: number;
  y: number;
}

export default function App() {
  const { spriteStyle, containerStyle, onTap, onPointerDown, onChatOpen } = useKeroPet();
  const [menu, setMenu] = useState<MenuPosition | null>(null);
  const menuRef = useRef<HTMLUListElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    if (!menu) return;

    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenu(null);
      }
    }

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menu]);

  // Auto-focus first menu item when menu opens
  useEffect(() => {
    if (!menu) return;
    const firstItem = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
    firstItem?.focus();
  }, [menu]);

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  }

  function handleOpenChatboard() {
    setMenu(null);
    onChatOpen();
  }

  return (
    <main
      className="pet-stage"
      onClick={onTap}
      onPointerDown={onPointerDown}
      onContextMenu={handleContextMenu}
      style={containerStyle}
    >
      <div className="pet-sprite" style={spriteStyle} aria-label="Kero desktop pet" />

      {menu && (
        <ul
          ref={menuRef}
          role="menu"
          style={{
            position: 'fixed',
            top: menu.y,
            left: menu.x,
            margin: 0,
            padding: '4px 0',
            listStyle: 'none',
            background: '#fff',
            border: '1px solid #ccc',
            borderRadius: 4,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            zIndex: 9999,
          }}
        >
          <li
            role="menuitem"
            tabIndex={0}
            onClick={handleOpenChatboard}
            onKeyDown={(e: KeyboardEvent<HTMLLIElement>) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleOpenChatboard();
              } else if (e.key === 'Escape') {
                setMenu(null);
              }
            }}
            style={{
              padding: '6px 16px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = '#f0f0f0')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = '')}
          >
            對話練習
          </li>
        </ul>
      )}
    </main>
  );
}
