import { SignedIn, SignedOut, RedirectToSignIn } from "@clerk/clerk-react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import Upload from "./pages/Upload";
import Jobs from "./pages/Jobs";
import JobDetail from "./pages/JobDetail";
import Failures from "./pages/Failures";
import TranscriptViewer from "./pages/TranscriptViewer";
import Admin from "./pages/Admin";

export default function App() {
  return (
    <BrowserRouter>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
      <SignedIn>
        <Layout>
          <Routes>
            <Route path="/" element={<Navigate to="/upload" replace />} />
            <Route path="/upload" element={<Upload />} />
            <Route path="/jobs" element={<Jobs />} />
            <Route path="/jobs/:id" element={<JobDetail />} />
            <Route path="/jobs/:id/transcript" element={<TranscriptViewer />} />
            <Route path="/failures" element={<Failures />} />
            <Route path="/admin" element={<Admin />} />
          </Routes>
        </Layout>
      </SignedIn>
    </BrowserRouter>
  );
}
