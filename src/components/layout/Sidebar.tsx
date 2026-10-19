import React from 'react';
import {
  LayoutDashboard,
  CheckSquare,
  Bot,
  Mic,
  BarChart3,
  Trophy,
  User,
  Sparkles,
  Palette,
} from 'lucide-react';
import { AppView, ThemeId } from '../../types';
import { useTheme } from '../../context/ThemeContext';
import { sound } from '../../utils/sound';

interface SidebarProps {
  currentView: AppView;
  onNavigate: (view: AppView) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentView, onNavigate }) => {
  const { currentTheme, setTheme, themes } = useTheme();

  const navItems = [
    { id: 'dashboard' as AppView, label: 'Dashboard', icon: LayoutDashboard },
    { id: 'habits' as AppView, label: 'My Habits', icon: CheckSquare },
    { id: 'coach' as AppView, label: 'AI Coach', icon: Bot, badge: 'Gemini' },
    { id: 'voice' as AppView, label: 'Voice AI', icon: Mic, badge: 'Live' },
    { id: 'analytics' as AppView, label: 'Analytics', icon: BarChart3 },
    { id: 'achievements' as AppView, label: 'Achievements', icon: Trophy },
    { id: 'profile' as AppView, label: 'Settings', icon: User },
  ];

  const handleCycleTheme = () => {
    const currentIndex = themes.findIndex((t) => t.id === currentTheme);
    const nextIndex = (currentIndex + 1) % themes.length;
    setTheme(themes[nextIndex].id);
    sound.playClick();
  };

  const activeThemeConfig = themes.find((t) => t.id === currentTheme) || themes[0];

  return (
    <aside className="hidden lg:flex flex-col w-64 bg-[#0c0e17] border-r border-neutral-800/80 p-4 shrink-0 min-h-[calc(100vh-61px)] transition-colors duration-300">
      {/* Navigation List */}
      <div className="space-y-1.5 flex-1">
        <p className="px-3 text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-2">
          Tracking & AI
        </p>

        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-medium transition-all ${
                isActive
                  ? 'bg-gradient-to-r from-violet-600/20 to-indigo-600/10 text-white border border-violet-500/30 shadow-sm'
                  : 'text-neutral-400 hover:text-white hover:bg-neutral-900/60'
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon
                  className={`w-4 h-4 ${
                    isActive ? 'text-violet-400' : 'text-neutral-400'
                  }`}
                />
                <span>{item.label}</span>
              </div>
              {item.badge && (
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                    item.badge === 'Live'
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 animate-pulse'
                      : 'bg-violet-500/20 text-violet-300 border border-violet-500/30'
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Theme Switcher Quick Toggle in Sidebar */}
      <div className="pt-3 border-t border-neutral-800/80 mb-3">
        <button
          onClick={handleCycleTheme}
          title="Click to cycle between 4 peaceful visual themes"
          className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-[#141724] hover:bg-[#1b1f33] border border-neutral-800 text-xs text-neutral-300 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Palette className="w-3.5 h-3.5 text-neutral-400" />
            <span className="text-[11px]">Theme</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: activeThemeConfig.colors.accent }}
            />
            <span className="text-[11px] font-medium text-white truncate max-w-[90px]">
              {activeThemeConfig.name}
            </span>
          </div>
        </button>
      </div>

      {/* AI Quick Callout Card */}
      <div className="p-3.5 rounded-2xl bg-gradient-to-br from-violet-950/40 to-indigo-950/30 border border-violet-500/20 text-left">
        <div className="flex items-center gap-2 mb-1.5">
          <Sparkles className="w-3.5 h-3.5 text-violet-400" />
          <span className="text-xs font-semibold text-white">Ritho Voice AI</span>
        </div>
        <p className="text-[11px] text-neutral-400 leading-relaxed mb-3">
          Speak hands-free with your personal habit coach.
        </p>
        <button
          onClick={() => onNavigate('voice')}
          className="w-full py-1.5 px-3 bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5 shadow-md shadow-violet-600/20"
        >
          <Mic className="w-3.5 h-3.5" />
          <span>Start Voice Chat</span>
        </button>
      </div>
    </aside>
  );
};
