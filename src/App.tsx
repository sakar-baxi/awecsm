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
import HealthMonitor from './components/HealthMonitor';

type View = 'dashboard' | 'credentials' | 'tools' | 'users' | 'audit' | 'approvals' | 'health-monitor';

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
    <div className="app-layout">
      {/* Sidebar navigation */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <img src="/tartan_logo.png" alt="Tartan" className="sidebar-logo-img" />
          <span className="sidebar-brand-name">Tartan</span>
          <span className="sidebar-brand-divider">/</span>
          <span className="sidebar-brand-role">Executive</span>
          <svg className="sidebar-brand-chevron" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-section">
            <span className="nav-section-title">Operations</span>
            <button 
              className={'sidebar-nav-btn' + (activeView === 'dashboard' ? ' active' : '')} 
              onClick={() => setActiveView('dashboard')}
            >
              <svg className="nav-btn-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="9" rx="1"/>
                <rect x="14" y="3" width="7" height="5" rx="1"/>
                <rect x="14" y="12" width="7" height="9" rx="1"/>
                <rect x="3" y="16" width="7" height="5" rx="1"/>
              </svg>
              Dashboard
            </button>
            <button 
              className={'sidebar-nav-btn' + (activeView === 'health-monitor' ? ' active' : '')} 
              onClick={() => setActiveView('health-monitor')}
            >
              <svg className="nav-btn-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
              </svg>
              Health Monitor
            </button>
            <button 
              className={'sidebar-nav-btn' + (activeView === 'tools' ? ' active' : '')} 
              onClick={() => setActiveView('tools')}
            >
              <svg className="nav-btn-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
              </svg>
              Tools
            </button>
          </div>

          <div className="nav-section">
            <span className="nav-section-title">Security & Audit</span>
            <button 
              className={'sidebar-nav-btn' + (activeView === 'credentials' ? ' active' : '')} 
              onClick={() => setActiveView('credentials')}
            >
              <svg className="nav-btn-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                <circle cx="12" cy="16" r="1"/>
              </svg>
              Credentials
            </button>
            <button 
              className={'sidebar-nav-btn' + (activeView === 'audit' ? ' active' : '')} 
              onClick={() => setActiveView('audit')}
            >
              <svg className="nav-btn-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
              Audit Log
            </button>
            {user.role === 'superadmin' && (
              <button 
                className={'sidebar-nav-btn' + (activeView === 'approvals' ? ' active' : '')} 
                onClick={() => setActiveView('approvals')}
              >
                <svg className="nav-btn-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                  <polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
                Approvals
              </button>
            )}
          </div>

          {user.role === 'superadmin' && (
            <div className="nav-section">
              <span className="nav-section-title">Administration</span>
              <button 
                className={'sidebar-nav-btn' + (activeView === 'users' ? ' active' : '')} 
                onClick={() => setActiveView('users')}
              >
                <svg className="nav-btn-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
                Users
              </button>
            </div>
          )}
        </nav>

        {/* Sidebar footer user profile */}
        <div className="sidebar-profile">
          <div className="profile-info">
            <div className="profile-avatar">
              {user.username.substring(0, 1).toUpperCase()}
            </div>
            <div className="profile-meta">
              <div className="profile-name">{user.username}</div>
              <div className="profile-email">{user.username}@tartanhq.c...</div>
            </div>
          </div>
          <button className="profile-chevron-btn" onClick={handleLogout} title="Logout">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="7 8 12 3 17 8"/>
              <polyline points="7 16 12 21 17 16"/>
            </svg>
          </button>
        </div>
      </aside>

      {/* Main Container */}
      <div className="main-layout-container">
        {/* Top Header Bar */}
        <header className="main-header">
          <div className="header-breadcrumbs">
            <span className="breadcrumb-root">Unified Platform</span>
            <span className="breadcrumb-separator">/</span>
            <span className="breadcrumb-active">
              {activeView === 'health-monitor' ? 'Health Monitor' : activeView.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
            </span>
          </div>
          <div className="header-status">
            <div className="status-indicator">
              <span className="pill-dot active" />
              <span className="status-label">Secure Session</span>
            </div>
          </div>
        </header>

        {/* Scrollable Content Pane */}
        <main className="main-content">
          {activeView === 'dashboard' && <Dashboard />}
          {activeView === 'health-monitor' && <HealthMonitor />}
          {activeView === 'credentials' && <Credentials />}
          {activeView === 'tools' && <Tools user={user} />}
          {activeView === 'users' && user.role === 'superadmin' && <UserManagement />}
          {activeView === 'audit' && <AuditLog />}
          {activeView === 'approvals' && user.role === 'superadmin' && <Approvals />}
        </main>
      </div>
    </div>
  );
}

export default App;
