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

/** Static in-window nav for the Chatboard window's Views. No routing. */
export default function AppSidebar({ active, onSelect }: AppSidebarProps) {
  return (
    <Sidebar collapsible="none" className="border-r border-sidebar-border">
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
                    onClick={() => onSelect(view)}
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
