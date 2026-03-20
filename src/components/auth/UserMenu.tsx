import React, { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '../../stores/authStore';
import './UserMenu.css';

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

  const label = user.email?.split('@')[0] ?? 'User';

  return (
    <div className="user-menu" ref={ref}>
      <button className="user-menu__trigger" onClick={() => setOpen(o => !o)}>
        {label} ▾
      </button>
      {open && (
        <div className="user-menu__dropdown">
          <button onClick={() => { onOpenSavedTrips(); setOpen(false); }}>
            Saved Trips
          </button>
          <button onClick={() => { signOut(); setOpen(false); }}>
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
};

export default UserMenu;
