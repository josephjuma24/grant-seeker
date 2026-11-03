import React, { useEffect, useId, useRef, useState } from 'react';
import { LogOut, Settings } from 'lucide-react';

// The avatar in the top-right corner: opens the account menu with profile
// settings and sign-out. Keyboard: Enter/Space/ArrowDown opens, arrows move,
// Escape closes and returns focus to the avatar.

interface Props {
  name: string;
  email: string;
  onProfile: () => void;
  onSignOut: () => void;
}

const initials = (name: string) =>
  name.split(' ').filter(Boolean).map((n) => n[0]).join('').substring(0, 2).toUpperCase();

export default function AccountMenu({ name, email, onProfile, onSignOut }: Props) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const items = () => [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const outside = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);

  const onMenuKey = (e: React.KeyboardEvent) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
    else if (e.key === 'Tab') setOpen(false);
  };

  const itemClass = 'w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold rounded-lg text-left focus:outline-none';

  return (
    <div className="relative">
      <button
        ref={button}
        id="header-avatar"
        type="button"
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); } }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Account menu for ${name}`}
        className={`w-9 h-9 bg-gray-100 rounded-full border border-gray-200 overflow-hidden flex items-center justify-center font-bold text-gray-600 text-xs cursor-pointer hover:bg-gray-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${open ? 'bg-gray-200' : ''}`}
      >
        {initials(name)}
      </button>

      {open && (
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label="Account"
          onKeyDown={onMenuKey}
          className="absolute right-0 top-full mt-2 z-50 w-64 max-w-[calc(100vw-2rem)] bg-white rounded-xl border border-gray-200 shadow-lg p-1.5"
        >
          <div className="px-3 py-2.5 border-b border-gray-100 mb-1">
            <p className="text-sm font-bold text-gray-900 truncate">{name}</p>
            <p className="text-xs text-gray-500 truncate" title={email}>{email}</p>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => { close(false); onProfile(); }}
            className={`${itemClass} text-gray-700 hover:bg-gray-50 focus:bg-gray-100`}
          >
            <Settings className="w-4 h-4 text-gray-500" aria-hidden="true" /> Match Profile Settings
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => { close(false); onSignOut(); }}
            className={`${itemClass} text-red-700 hover:bg-red-50 focus:bg-red-50`}
          >
            <LogOut className="w-4 h-4" aria-hidden="true" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
