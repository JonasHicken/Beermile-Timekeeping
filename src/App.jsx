import { Routes, Route, Navigate } from 'react-router-dom'
import Home from './pages/Home.jsx'
import Setup from './pages/Setup.jsx'
import Timing from './pages/Timing.jsx'
import Review from './pages/Review.jsx'
import Live from './pages/Live.jsx'
import Join from './pages/Join.jsx'
import RaceAdmin from './pages/RaceAdmin.jsx'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/event/:eventId/setup" element={<Setup />} />
      <Route path="/event/:eventId/heat/:heatId" element={<Timing />} />
      <Route path="/event/:eventId/heat/:heatId/review" element={<Review />} />
      <Route path="/event/:eventId/live" element={<Live />} />
      <Route path="/event/:eventId/admin" element={<RaceAdmin />} />
      <Route path="/join/:eventId" element={<Join />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
