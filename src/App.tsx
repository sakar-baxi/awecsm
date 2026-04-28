import { useState, useEffect } from 'react';
import { saveAuth, loadUser, clearAuth } from './api';
import type { UserInfo } from './api';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import Credentials from './components/Credentials';
import UserManagement from './components/UserManagement';
import AuditLog from './components/AuditLog';
import Tools from './components/Tools';
import Approvals from './components/Approvals';

type View = 'dashboard' | 'credentials' | 'tools' | 'users' | 'audit' | 'approvals';

function App() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [checking, setChecking] = useState(true);
  const [activeView, setActiveView] = useState<View>('dashboard');

  useEffect(() => {
    const saved = loadUser();
    if (saved) {
      // Validate token is still valid
      fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + localStorage.getItem('tartan_token') } })
        .then(r => { if (r.ok) return r.json(); throw new Error('expired'); })
        .then(u => { setUser(u); setChecking(false); })
        .catch(() => { clearAuth(); setChecking(false); });
    } else {
      setChecking(false);
    }
  }, []);

  const handleLogin = (token: string, u: UserInfo) => {
    saveAuth(token, u);
    setUser(u);
  };

  const handleLogout = () => {
    clearAuth();
    setUser(null);
    setActiveView('dashboard');
  };

  if (checking) {
    return (
      <div className="login-wrapper">
        <div className="spinner" style={{ width: '2rem', height: '2rem' }} />
      </div>
    );
  }

  if (!user) return <Login onLogin={handleLogin} />;

  return (
    <>
      <div className="top-nav">
        <div className="nav-container">
          <div className="nav-logo"><span className="badge-dot" /> TartanHQ</div>
          <div className="nav-links">
            <button className={'nav-btn' + (activeView === 'dashboard' ? ' active' : '')} onClick={() => setActiveView('dashboard')}>Dashboard</button>
            <button className={'nav-btn' + (activeView === 'credentials' ? ' active' : '')} onClick={() => setActiveView('credentials')}>Credentials</button>
            <button className={'nav-btn' + (activeView === 'tools' ? ' active' : '')} onClick={() => setActiveView('tools')}>Tools</button>
            {user.role === 'superadmin' && (
              <button className={'nav-btn' + (activeView === 'users' ? ' active' : '')} onClick={() => setActiveView('users')}>Users</button>
            )}
            <button className={'nav-btn' + (activeView === 'audit' ? ' active' : '')} onClick={() => setActiveView('audit')}>Audit Log</button>
            {user.role === 'superadmin' && (
              <button className={'nav-btn' + (activeView === 'approvals' ? ' active' : '')} onClick={() => setActiveView('approvals')}>Approvals</button>
            )}
            <div className="nav-user">
              <span className="nav-username">{user.username}</span>
              <button className="nav-btn logout" onClick={handleLogout}>Logout</button>
            </div>
          </div>
        </div>
      </div>

      <div className="main-content">
        {activeView === 'dashboard' && <Dashboard />}
        {activeView === 'credentials' && <Credentials />}
        {activeView === 'tools' && <Tools user={user} />}
        {activeView === 'users' && user.role === 'superadmin' && <UserManagement />}
        {activeView === 'audit' && <AuditLog />}
        {activeView === 'approvals' && user.role === 'superadmin' && <Approvals />}
      </div>
    </>
  );
}

export default App;
