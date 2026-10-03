import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Settings,
  Save,
  Eye,
  EyeOff,
  CheckCircle,
  RotateCcw,
  Copy,
  Check,
} from 'lucide-react';
import { useConfig } from '@/hooks/useConfig';
import type { HaloConfig } from '@/hooks/useConfig';
import {
  buildAuthServer,
  buildResourceServer,
  isValidTenantSlug,
  validateServerUrl,
} from '@/lib/server-url';

export const ConfigDialog: React.FC = () => {
  const { config, isConfigured, saveConfig, resetConfig } = useConfig();
  const [isOpen, setIsOpen] = useState(false);
  const [localConfig, setLocalConfig] = useState<HaloConfig>(config);
  const [showClientSecret, setShowClientSecret] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof HaloConfig, string>>>({});

  // Update localConfig when config changes
  useEffect(() => {
    setLocalConfig(config);
  }, [config]);

  const validateLocalConfig = (
    candidate: HaloConfig
  ): Partial<Record<keyof HaloConfig, string>> => {
    const nextErrors: Partial<Record<keyof HaloConfig, string>> = {};
    // Manually entered config may use self-hosted Halo instances, so custom
    // hosts are allowed here — but the URL must still be well-formed https.
    // Empty fields are permitted (the config is simply incomplete then).
    if (candidate.tenant.trim() && !isValidTenantSlug(candidate.tenant)) {
      nextErrors.tenant =
        'Use letters, digits, and hyphens only (e.g. yourcompany).';
    }
    if (candidate.resourceServer.trim()) {
      const error = validateServerUrl(candidate.resourceServer, {
        allowCustomHosts: true,
        label: 'Resource server',
      });
      if (error) {
        nextErrors.resourceServer = error;
      }
    }
    if (candidate.authServer.trim()) {
      const error = validateServerUrl(candidate.authServer, {
        allowCustomHosts: true,
        label: 'Auth server',
      });
      if (error) {
        nextErrors.authServer = error;
      }
    }
    return nextErrors;
  };

  const handleSave = () => {
    const nextErrors = validateLocalConfig(localConfig);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }
    saveConfig(localConfig);
    setIsOpen(false);
  };

  const handleCancel = () => {
    setLocalConfig(config);
    setErrors({});
    setIsOpen(false);
  };

  const handleReset = () => {
    resetConfig();
    setErrors({});
    setLocalConfig({
      tenant: '',
      authServer: '',
      resourceServer: '',
      clientId: '',
      redirectUri: config.redirectUri, // Keep the auto-generated redirect URI
    });
  };

  const handleInputChange = (field: keyof HaloConfig, value: string) => {
    const updates: Partial<HaloConfig> = { [field]: value };

    // Auto-fill Resource Server when tenant is entered
    if (field === 'tenant' && value.trim()) {
      const resourceServer = buildResourceServer(value);
      updates.resourceServer = resourceServer;
      // Also auto-fill Auth Server since we now have Resource Server
      updates.authServer = buildAuthServer(resourceServer);
    }

    // Auto-fill Auth Server when Resource Server is entered
    if (field === 'resourceServer' && value.trim()) {
      updates.authServer = buildAuthServer(value);
    }

    setErrors((prev) => {
      if (Object.keys(prev).length === 0) {
        return prev;
      }
      const next = { ...prev };
      delete next[field];
      if (updates.resourceServer !== undefined) {
        delete next.resourceServer;
      }
      if (updates.authServer !== undefined) {
        delete next.authServer;
      }
      return next;
    });
    setLocalConfig((prev) => ({ ...prev, ...updates }));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    }
  };

  const handleCopyConfigUrl = async () => {
    const params = new URLSearchParams();

    if (config.tenant) params.set('tenant', config.tenant);
    if (config.resourceServer) params.set('resourceServer', config.resourceServer);
    if (config.authServer) params.set('authServer', config.authServer);
    if (config.clientId) params.set('clientId', config.clientId);
    if (config.redirectUri) params.set('redirectUri', config.redirectUri);

    const baseUrl = window.location.origin;
    const loginPath = '/login';
    const configUrl = `${baseUrl}${loginPath}?${params.toString()}`;

    try {
      await navigator.clipboard.writeText(configUrl);
      setUrlCopied(true);
      setTimeout(() => setUrlCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy URL:', err);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full h-12 px-3" title="Configure">
          <Settings className="h-4 w-4 mr-2" />
          {isConfigured && (
            <CheckCircle className="h-4 w-4 ml-2 text-green-600" />
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Halo Configuration</DialogTitle>
          {isConfigured && (
            <div className="space-y-2">
              <div className="text-sm text-green-600 flex items-center gap-2">
                <CheckCircle className="h-4 w-4" />
                Configuration complete! You can now log in.
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyConfigUrl}
                className="w-full"
              >
                {urlCopied ? (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    URL Copied!
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 mr-2" />
                    Copy Config URL
                  </>
                )}
              </Button>
            </div>
          )}
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="tenant" className="text-right">
              Tenant
            </Label>
            <Input
              id="tenant"
              value={localConfig.tenant}
              onChange={(e) => handleInputChange('tenant', e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="yourcompany"
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 gap-4">
            <div></div>
            <div className="col-span-3 text-xs text-muted-foreground">
              Use if you're using the hosted version of HaloPSA. This will
              autofill Resource Server to be: https://tenant.halopsa.com
            </div>
          </div>
          {errors.tenant && (
            <div className="grid grid-cols-4 gap-4">
              <div></div>
              <div className="col-span-3 text-xs text-destructive">
                {errors.tenant}
              </div>
            </div>
          )}

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="resourceServer" className="text-right">
              Resource Server
            </Label>
            <Input
              id="resourceServer"
              value={localConfig.resourceServer}
              onChange={(e) =>
                handleInputChange('resourceServer', e.target.value)
              }
              onKeyDown={handleKeyDown}
              placeholder="https://mymsp.halopsa.com"
              className="col-span-3"
            />
          </div>
          {errors.resourceServer && (
            <div className="grid grid-cols-4 gap-4">
              <div></div>
              <div className="col-span-3 text-xs text-destructive">
                {errors.resourceServer}
              </div>
            </div>
          )}

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="authServer" className="text-right">
              Auth Server
            </Label>
            <Input
              id="authServer"
              value={localConfig.authServer}
              onChange={(e) => handleInputChange('authServer', e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="https://mymsp.halopsa.com/auth"
              className="col-span-3"
            />
          </div>
          {errors.authServer && (
            <div className="grid grid-cols-4 gap-4">
              <div></div>
              <div className="col-span-3 text-xs text-destructive">
                {errors.authServer}
              </div>
            </div>
          )}

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="clientId" className="text-right">
              Client ID
            </Label>
            <div className="col-span-3 flex gap-2">
              <Input
                id="clientId"
                type={showClientSecret ? 'text' : 'password'}
                value={localConfig.clientId}
                onChange={(e) => handleInputChange('clientId', e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Your OAuth client ID"
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowClientSecret(!showClientSecret)}
              >
                {showClientSecret ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="redirectUri" className="text-right">
              Redirect URI
            </Label>
            <Input
              id="redirectUri"
              value={localConfig.redirectUri}
              readOnly
              className="col-span-3 bg-muted"
            />
            <div className="col-span-3 col-start-2 text-xs text-muted-foreground mt-1">
              This is automatically generated. Use this value when setting up
              your OAuth application in Halo.
            </div>
          </div>

          <div className="text-center pt-2">
            <button
              type="button"
              onClick={handleReset}
              className="text-sm text-muted-foreground hover:text-destructive transition-colors flex items-center gap-1 mx-auto"
            >
              <RotateCcw className="h-3 w-3" />
              Reset to defaults
            </button>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            <Save className="h-4 w-4 mr-2" />
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
