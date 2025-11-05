import { useState } from 'react';
import { User } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Agent } from '@/types';

interface AgentAvatarProps {
  agent: Agent;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
  showName?: boolean;
  resourceServer?: string;
}

const sizeClasses = {
  xs: 'w-4 h-4 text-[8px]',
  sm: 'w-6 h-6 text-[10px]',
  md: 'w-8 h-8 text-xs',
  lg: 'w-10 h-10 text-sm',
};

const iconSizes = {
  xs: 'w-2 h-2',
  sm: 'w-3 h-3',
  md: 'w-4 h-4',
  lg: 'w-5 h-5',
};

/**
 * AgentAvatar Component
 *
 * Displays an agent's avatar with the following fallback:
 * 1. Profile photo if available
 * 2. Colored circle with initials if no photo
 * 3. Generic user icon if no initials
 *
 * The placeholder background uses the agent's color property.
 */
export function AgentAvatar({
  agent,
  size = 'sm',
  className,
  showName = false,
  resourceServer,
}: AgentAvatarProps) {
  const [imageError, setImageError] = useState(false);

  const getPhotoUrl = () => {
    if (!agent.avatar || !resourceServer) return null;

    // Remove trailing slash from resource server if present
    const baseUrl = resourceServer.replace(/\/$/, '');

    // Handle absolute URLs
    if (agent.avatar.startsWith('http')) {
      return agent.avatar;
    }

    // Ensure path starts with /api (Halo PSA convention)
    if (agent.avatar.startsWith('/api')) {
      return `${baseUrl}${agent.avatar}`;
    }

    return `${baseUrl}/api${agent.avatar}`;
  };

  const photoUrl = getPhotoUrl();
  const showPhoto = photoUrl && !imageError;

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="relative flex-shrink-0">
        {showPhoto ? (
          <img
            src={photoUrl}
            alt={agent.name}
            className={cn(
              'rounded-full object-cover',
              sizeClasses[size]
            )}
            onError={() => setImageError(true)}
          />
        ) : agent.initials ? (
          <div
            className={cn(
              'rounded-full flex items-center justify-center font-medium text-white',
              sizeClasses[size]
            )}
            style={{ backgroundColor: agent.color }}
            title={agent.name}
          >
            {agent.initials}
          </div>
        ) : (
          <div
            className={cn(
              'rounded-full flex items-center justify-center',
              sizeClasses[size]
            )}
            style={{ backgroundColor: agent.color }}
            title={agent.name}
          >
            <User className={cn('text-white', iconSizes[size])} />
          </div>
        )}
      </div>
      {showName && (
        <span className="text-sm truncate">{agent.name}</span>
      )}
    </div>
  );
}
