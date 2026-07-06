import { useState } from 'react';

type Props = { onLogin: (token: string, user: { id: string; username: string; role: 'superadmin' | 'user' }) => void };

export default function Login({ onLogin }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const text = await res.text();
      let data: { error?: string; token?: string; user?: { id: string; username: string; role: 'superadmin' | 'user' } };
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        throw new Error(
          res.status === 404
            ? 'Login API not found. Check Vercel deployment and /api routes.'
            : 'Server returned an invalid response. Try again or contact support.'
        );
      }
      if (!res.ok) throw new Error(data.error || `Login failed (HTTP ${res.status})`);
      if (!data.token || !data.user) throw new Error('Login response missing token');
      onLogin(data.token, data.user);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page-container">
      {/* Grid Pattern and Gradient Background */}
      <div className="login-grid-overlay" />
      <div className="login-radial-glow" />

      {/* Top Left Logo Brand */}
      <header className="login-page-brand">
        <img src="/tartan_logo.png" alt="Tartan" className="login-brand-logo-img" />
        <span className="login-brand-text">Tartan</span>
      </header>

      {/* Centered Login Card */}
      <div className="login-card-container">
        <div className="login-card">
          <div className="login-card-header">
            <h1 className="login-card-title">Log in to Unified Platform</h1>
            <p className="login-card-subtitle">Fill in the credentials sent to your email</p>
          </div>

          <form onSubmit={handleSubmit} className="login-card-form">
            <div className="login-input-group">
              <label className="login-input-label">Username</label>
              <div className="login-input-with-icon">
                <svg className="login-input-icon-prefix" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                <input 
                  required 
                  className="login-field-input" 
                  value={username} 
                  onChange={e => setUsername(e.target.value)} 
                  placeholder="Enter your username" 
                  autoFocus 
                />
              </div>
            </div>
            
            <div className="login-input-group" style={{ marginTop: '1.25rem' }}>
              <label className="login-input-label">Password</label>
              <div className="login-input-with-icon">
                <svg className="login-input-icon-prefix" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <input 
                  required 
                  className="login-field-input" 
                  type={showPassword ? 'text' : 'password'} 
                  value={password} 
                  onChange={e => setPassword(e.target.value)} 
                  placeholder="Enter your password" 
                />
                <button 
                  type="button" 
                  className="login-password-toggle-btn"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  <svg className="login-input-icon-suffix" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {showPassword ? (
                      <>
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </>
                    ) : (
                      <>
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </>
                    )}
                  </svg>
                </button>
              </div>
              <div className="login-forgot-row">
                <a href="#forgot" className="login-forgot-link" onClick={e => e.preventDefault()}>Forgot Password?</a>
              </div>
            </div>

            {error && (
              <div className="login-error-message" style={{ marginTop: '1.25rem' }}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" width="16" height="16">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                </svg>
                {error}
              </div>
            )}
            
            <button type="submit" disabled={loading || !username || !password} className="login-submit-btn">
              {loading ? <div className="login-spinner" /> : 'Log in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}


