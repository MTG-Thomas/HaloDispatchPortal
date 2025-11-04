import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useDispatchStore } from '@/stores/useDispatchStore';
import { format } from 'date-fns';

/**
 * ApiErrorPage Component
 *
 * Displays a full-page error when there's a critical API issue (CORS, network, etc.)
 * Prevents infinite retries by requiring manual retry from the user
 */
export function ApiErrorPage() {
  const { criticalApiError, retryAfterError } = useDispatchStore();

  if (!criticalApiError) {
    return null;
  }

  const handleRetry = () => {
    retryAfterError();
  };

  return (
    <div className="fixed inset-0 z-50 bg-background flex items-center justify-center p-4">
      <Card className="max-w-lg w-full p-8">
        <div className="flex flex-col items-center text-center space-y-6">
          {/* Error Icon */}
          <div className="rounded-full bg-destructive/10 p-4">
            <AlertCircle className="h-12 w-12 text-destructive" />
          </div>

          {/* Error Message */}
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-foreground">
              {criticalApiError.message}
            </h1>
            {criticalApiError.details && (
              <p className="text-sm text-muted-foreground">
                {criticalApiError.details}
              </p>
            )}
          </div>

          {/* Timestamp */}
          <p className="text-xs text-muted-foreground">
            Error occurred at {format(criticalApiError.timestamp, 'MMM d, yyyy h:mm:ss a')}
          </p>

          {/* Troubleshooting Info */}
          <div className="w-full p-4 bg-muted/50 rounded-lg space-y-2 text-left">
            <h2 className="text-sm font-semibold text-foreground">
              Common causes:
            </h2>
            <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
              <li>CORS (Cross-Origin Resource Sharing) configuration issue</li>
              <li>Halo PSA API server is unreachable or offline</li>
              <li>Network connectivity problems</li>
              <li>API credentials need to be refreshed</li>
            </ul>
          </div>

          {/* Retry Button */}
          <Button onClick={handleRetry} size="lg" className="w-full">
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry Connection
          </Button>

          {/* Additional Help */}
          <p className="text-xs text-muted-foreground">
            If the problem persists, contact your system administrator
          </p>
        </div>
      </Card>
    </div>
  );
}
