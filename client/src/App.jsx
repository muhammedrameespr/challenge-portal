import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthContext.jsx';
import { Brand, ErrorState, Loading, Shell } from './components/UI.jsx';
import Login from './pages/Login.jsx';
import Challenges from './pages/Challenges.jsx';
import ChallengeDetail from './pages/ChallengeDetail.jsx';
import AdminChallenges from './pages/AdminChallenges.jsx';
import ChallengeEditor from './pages/ChallengeEditor.jsx';

function Guard({ admin = false }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }}/>;
  if (admin && user.role !== 'ADMIN') return <Navigate to="/challenges" replace/>;
  return <Outlet/>;
}

function Layout() { return <Shell><Outlet/></Shell>; }

export default function App() {
  const { user, loading, error, initialize } = useAuth();
  if (loading) return <div className="startup"><Brand/><Loading text="Opening your workspace…"/></div>;
  if (error) return <div className="startup"><Brand/><ErrorState message={error} retry={initialize}/></div>;
  const home = user?.role === 'ADMIN' ? '/admin/challenges' : '/challenges';
  return <Routes>
    <Route path="/login" element={user ? <Navigate to={home} replace/> : <Login/>}/>
    <Route element={<Guard/>}>
      <Route element={<Layout/>}>
        <Route path="/challenges" element={<Challenges/>}/>
        <Route path="/challenges/:id" element={<ChallengeDetail/>}/>
        <Route element={<Guard admin/>}>
          <Route path="/admin/challenges" element={<AdminChallenges/>}/>
          <Route path="/admin/challenges/new" element={<ChallengeEditor key="new"/>}/>
          <Route path="/admin/challenges/:id/edit" element={<ChallengeEditor/>}/>
        </Route>
      </Route>
    </Route>
    <Route path="*" element={<Navigate to={user ? home : '/login'} replace/>}/>
  </Routes>;
}
