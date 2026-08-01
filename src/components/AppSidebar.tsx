import { MessageCircle, Settings } from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';

export type ChatboardView = 'practice' | 'settings';

const ITEMS: { view: ChatboardView; label: string; icon: typeof MessageCircle }[] = [
  { view: 'practice', label: '語言練習', icon: MessageCircle },
  { view: 'settings', label: '設定', icon: Settings },
];

export interface AppSidebarProps {
  active: ChatboardView;
  onSelect: (view: ChatboardView) => void;
}

/**
 * In-window nav for the Chatboard window's Views. No routing. Rendered as an
 * offcanvas drawer: full window height, toggleable, and (via the provider's
 * mobile breakpoint) auto-collapsed to a closed sheet on a small window.
 */
export default function AppSidebar({ active, onSelect }: AppSidebarProps) {
  const { isMobile, setOpenMobile } = useSidebar();

  const handleSelect = (view: ChatboardView) => {
    onSelect(view);
    // Close the drawer after picking a View on a small window.
    if (isMobile) setOpenMobile(false);
  };

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader className="px-3 py-3">
        <span className="text-base font-semibold">🐸 Kero</span>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {ITEMS.map(({ view, label, icon: Icon }) => (
                <SidebarMenuItem key={view}>
                  <SidebarMenuButton
                    isActive={active === view}
                    onClick={() => handleSelect(view)}
                  >
                    <Icon />
                    <span>{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
