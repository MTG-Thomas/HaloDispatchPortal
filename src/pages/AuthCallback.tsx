import React, { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

const AuthCallback: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { handleCallback, isAuthenticated } = useAuth();
  const hasProcessed = useRef(false);
  const processingRef = useRef(false);

  useEffect(() => {
    const processCallback = async () => {
      // Prevent multiple processing attempts
      if (hasProcessed.current) {
        return;
      }

      // Prevent concurrent processing
      if (processingRef.current) {
        return;
      }

      const code = searchParams.get('code');
      const error = searchParams.get('error');


      if (error) {
        hasProcessed.current = true;
        navigate('/login?error=' + encodeURIComponent(error), {
          replace: true,
        });
        return;
      }

      if (!code) {
        hasProcessed.current = true;
        navigate('/login?error=no_code', { replace: true });
        return;
      }

      hasProcessed.current = true;
      processingRef.current = true;

      try {
        // Process the callback - this will update the auth state
        await handleCallback(code);
      } finally {
        processingRef.current = false;
      }
    };

    processCallback();

    // Cleanup function to handle component unmounting
    return () => {
      // Reset the processing flag if component unmounts during processing
      processingRef.current = false;
    };
  }, [searchParams, handleCallback, navigate]);

  // Watch for authentication state changes and redirect when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  // Show loading while processing
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        <Loader2 className="h-12 w-12 animate-spin mx-auto mb-4 text-primary" />
        <h1 className="text-2xl font-semibold mb-2">
          Completing Authentication
        </h1>
        <p className="text-muted-foreground">
          Please wait while we complete your login...
        </p>
      </div>
    </div>
  );
};

export default AuthCallback;
