import React, { useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import './AuthModal.css';

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
      setInfo('Check your email to confirm your account.');
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
        <button className="auth-modal__close" onClick={onClose}>✕</button>

        <h2>{mode === 'login' ? 'Sign In' : 'Create Account'}</h2>

        <form onSubmit={handleSubmit} className="auth-modal__form">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />

          {error && <p className="auth-modal__error">{error}</p>}
          {info  && <p className="auth-modal__info">{info}</p>}

          <button type="submit" disabled={busy} className="auth-modal__submit">
            {busy ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Register'}
          </button>
        </form>

        <button className="auth-modal__google" onClick={handleGoogle} disabled={busy}>
          Continue with Google
        </button>

        <p className="auth-modal__switch">
          {mode === 'login'
            ? <><span>No account?</span> <button type="button" onClick={() => setMode('register')}>Register</button></>
            : <><span>Have an account?</span> <button type="button" onClick={() => setMode('login')}>Sign In</button></>
          }
        </p>
      </div>
    </div>
  );
};

export default AuthModal;
