'use client';

import { useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export default function ProductionCard({ production, onRefresh }) {
  const [status, setStatus] = useState(production.status);
  const [approving, setApproving] = useState(false);
  const [publishing, setPublishing] = useState(false);

  async function handleApprove() {
    setApproving(true);
    try {
      const res = await fetch(`${API_URL}/api/productions/${production.id}/approve`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to approve');
      setStatus('approved');
      onRefresh();
    } catch (err) {
      console.error('Error approving:', err);
      alert('Failed to approve production');
    } finally {
      setApproving(false);
    }
  }

  async function handlePublish() {
    setPublishing(true);
    try {
      const res = await fetch(`${API_URL}/api/productions/${production.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platforms: production.platforms || ['tiktok'],
        }),
      });
      if (!res.ok) throw new Error('Failed to publish');
      setStatus('published');
      onRefresh();
    } catch (err) {
      console.error('Error publishing:', err);
      alert('Failed to publish production');
    } finally {
      setPublishing(false);
    }
  }

  function getStatusColor(status) {
    switch (status) {
      case 'queued':
        return 'bg-yellow-100 text-yellow-800';
      case 'in_progress':
        return 'bg-blue-100 text-blue-800';
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'approved':
        return 'bg-purple-100 text-purple-800';
      case 'published':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <h3 className="text-base font-semibold text-gray-900 mb-1">
            {production.title}
          </h3>
          <p className="text-sm text-gray-600">
            Created {new Date(production.created_at).toLocaleDateString()}
          </p>
        </div>
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(status)}`}>
          {status.replace('_', ' ')}
        </span>
      </div>

      {/* Platforms */}
      {production.platforms && production.platforms.length > 0 && (
        <div className="mb-3">
          <div className="flex gap-2">
            {production.platforms.map((platform) => (
              <span
                key={platform}
                className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs"
              >
                {platform === 'tiktok' && '🎵 TikTok'}
                {platform === 'instagram' && '📸 Instagram'}
                {platform === 'youtube' && '📺 YouTube'}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-3 border-t border-gray-200">
        {status === 'completed' && (
          <button
            onClick={handleApprove}
            disabled={approving}
            className="flex-1 py-2 px-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {approving ? 'Approving...' : 'Approve'}
          </button>
        )}
        {status === 'approved' && (
          <button
            onClick={handlePublish}
            disabled={publishing}
            className="flex-1 py-2 px-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {publishing ? 'Publishing...' : 'Publish'}
          </button>
        )}
      </div>
    </div>
  );
}
