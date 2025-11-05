import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { DragProvider } from './contexts/DragContext';
import { DispatchView } from './components/DispatchView';
import { ApiErrorPage } from './components/ApiErrorPage';
import { Toaster } from '@/components/ui/sonner';
import Login from './pages/Login';
import AuthCallback from './pages/AuthCallback';

function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <DragProvider>
            {/* Critical API Error Overlay - Shows on top of everything */}
            <ApiErrorPage />

            <Routes>
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <DispatchView />
                  </ProtectedRoute>
                }
              />
              <Route path="/login" element={<Login />} />
              <Route path="/auth/callback" element={<AuthCallback />} />
            </Routes>

            {/* Toast notifications */}
            <Toaster />
          </DragProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

export default App;
