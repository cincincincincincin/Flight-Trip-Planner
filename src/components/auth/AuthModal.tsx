import React, { useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import './AuthModal.css';
import { TEXTS } from '../../constants/text';
import { UI_SYMBOLS } from '../../constants/ui';

type Mode = 'login' | 'register';

interface AuthModalProps {
  onClose: () => void;
}

const AuthModal: React.FC<AuthModalProps> = ({ onClose }) => {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { signInWithEmail, signUpWithEmail, signInWithGoogle } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);

    const fn = mode === 'login' ? signInWithEmail : signUpWithEmail;
    const { error: err } = await fn(email, password);

    setBusy(false);

    if (err) {
      setError(err);
    } else if (mode === 'register') {
      setInfo(TEXTS.auth.checkEmail);
    } else {
      onClose();
    }
  };

  const handleGoogle = async () => {
    setBusy(true);
    const { error: err } = await signInWithGoogle();
    if (err) { setError(err); setBusy(false); }
  };

  return (
    <div className="auth-modal-overlay" onClick={onClose}>
      <div className="auth-modal" onClick={e => e.stopPropagation()}>
        <button className="auth-modal__close" onClick={onClose}>{UI_SYMBOLS.CLOSE}</button>

        <h2>{mode === 'login' ? TEXTS.buttons.signIn : TEXTS.auth.createAccount}</h2>

        <form onSubmit={handleSubmit} className="auth-modal__form">
          <input
            type="email"
            placeholder={TEXTS.auth.email}
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
          <input
            type="password"
            placeholder={TEXTS.auth.password}
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />

          {error && <p className="auth-modal__error">{error}</p>}
          {info  && <p className="auth-modal__info">{info}</p>}

          <button type="submit" disabled={busy} className="auth-modal__submit">
            {busy ? TEXTS.auth.pleaseWait : mode === 'login' ? TEXTS.buttons.signIn : TEXTS.auth.register}
          </button>
        </form>

        <button className="auth-modal__google" onClick={handleGoogle} disabled={busy}>{TEXTS.auth.continueGoogle}</button>

        <p className="auth-modal__switch">
          {mode === 'login'
            ? <><span>{TEXTS.auth.noAccount}</span> <button type="button" onClick={() => setMode('register')}>{TEXTS.buttons.register}</button></>
            : <><span>{TEXTS.auth.haveAccount}</span> <button type="button" onClick={() => setMode('login')}>{TEXTS.buttons.signIn}</button></>
          }
        </p>
      </div>
    </div>
  );
};

export default AuthModal;
