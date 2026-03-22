import React, { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '../../stores/authStore';
import './UserMenu.css';
import { TEXTS } from '../../constants/text';
import { UI_SYMBOLS } from '../../constants/ui';

interface UserMenuProps {
  onOpenSavedTrips: () => void;
}

const UserMenu: React.FC<UserMenuProps> = ({ onOpenSavedTrips }) => {
  const { user, signOut } = useAuthStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (!user) return null;

  const label = user.email?.split('@')[0] ?? TEXTS.common.userFallback;

  return (
    <div className="user-menu" ref={ref}>
      <button className="user-menu__trigger" onClick={() => setOpen(o => !o)}>
        {label} {UI_SYMBOLS.DROPDOWN}
      </button>
      {open && (
        <div className="user-menu__dropdown">
          <button onClick={() => { onOpenSavedTrips(); setOpen(false); }}>{TEXTS.savedTrips.title}</button>
          <button onClick={() => { signOut(); setOpen(false); }}>{TEXTS.buttons.signOut}</button>
        </div>
      )}
    </div>
  );
};

export default UserMenu;
