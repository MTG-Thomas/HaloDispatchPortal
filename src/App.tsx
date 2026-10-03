import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AuthProvider } from "./contexts/AuthContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import { DragProvider } from "./contexts/DragContext";
import { ApiErrorPage } from "./components/ApiErrorPage";
import { Toaster } from "@/components/ui/sonner";
import { LoadingScreen } from "@/components/LoadingScreen";
import { ErrorBoundary } from "./components/ErrorBoundary";

// Lazy load routes for code splitting
const Login = lazy(() => import("./pages/Login"));
const AuthCallback = lazy(() => import("./pages/AuthCallback"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Book = lazy(() => import("./pages/Book"));
const DispatchView = lazy(() =>
    import("./components/DispatchView").then((module) => ({ default: module.DispatchView })),
);

function App() {
    return (
        <BrowserRouter>
            <ThemeProvider>
                <AuthProvider>
                    <DragProvider>
                        {/* Critical API Error Overlay - Shows on top of everything */}
                        <ApiErrorPage />

                        <ErrorBoundary>
                            <Suspense fallback={<LoadingScreen />}>
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
                                    {/* Public customer booking link: no login gate. */}
                                    <Route path="/book/:token" element={<Book />} />
                                    <Route path="*" element={<NotFound />} />
                                </Routes>
                            </Suspense>
                        </ErrorBoundary>

                        {/* Toast notifications */}
                        <Toaster />
                    </DragProvider>
                </AuthProvider>
            </ThemeProvider>
        </BrowserRouter>
    );
}

export default App;
