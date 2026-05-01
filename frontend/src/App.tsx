import { SignedIn, SignedOut, RedirectToSignIn } from "@clerk/clerk-react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import AdminLayout from "./components/AdminLayout";
import Upload from "./pages/Upload";
import Jobs from "./pages/Jobs";
import JobDetail from "./pages/JobDetail";
import Failures from "./pages/Failures";
import TranscriptViewer from "./pages/TranscriptViewer";
import AdminUsers from "./pages/AdminUsers";
import AdminBilling from "./pages/AdminBilling";

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

            {/* Admin section — sidebar layout */}
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<Navigate to="/admin/users" replace />} />
              <Route path="users" element={<AdminUsers />} />
              <Route path="billing" element={<AdminBilling />} />
            </Route>
          </Routes>
        </Layout>
      </SignedIn>
    </BrowserRouter>
  );
}
