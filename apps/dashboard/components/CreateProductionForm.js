'use client';

import { useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const BUSINESS_ID = process.env.NEXT_PUBLIC_BUSINESS_ID;
const BRAND_ID = process.env.NEXT_PUBLIC_BRAND_ID;

export default function CreateProductionForm({ onCreated }) {
  const [topic, setTopic] = useState('');
  const [platforms, setPlatforms] = useState(['tiktok']);
  const [seriesId, setSeriesId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  function togglePlatform(platform) {
    if (platforms.includes(platform)) {
      setPlatforms(platforms.filter(p => p !== platform));
    } else {
      setPlatforms([...platforms, platform]);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const res = await fetch(`${API_URL}/api/productions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: BUSINESS_ID,
          brand_id: BRAND_ID,
          topic,
          platforms,
          series_id: seriesId || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to create production');
      }

      const data = await res.json();
      setSuccess(true);
      setTopic('');
      setPlatforms(['tiktok']);
      setSeriesId('');

      // Notify parent
      onCreated({
        id: data.id,
        title: topic,
        status: data.status,
        created_at: new Date().toISOString(),
        platforms,
      });

      // Clear success message after 3 seconds
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      console.error('Error creating production:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">
        Create New Video
      </h2>

      {/* Topic */}
      <div className="mb-4">
        <label htmlFor="topic" className="block text-sm font-medium text-gray-700 mb-2">
          What's the video about?
        </label>
        <textarea
          id="topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g., Why Roman pizza is thin"
          rows={3}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          required
          minLength={10}
        />
        <p className="text-xs text-gray-500 mt-1">
          Minimum 10 characters
        </p>
      </div>

      {/* Platforms */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Platforms
        </label>
        <div className="flex gap-2">
          {['tiktok', 'instagram', 'youtube'].map((platform) => (
            <button
              key={platform}
              type="button"
              onClick={() => togglePlatform(platform)}
              className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
                platforms.includes(platform)
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              {platform === 'tiktok' && '🎵 TikTok'}
              {platform === 'instagram' && '📸 Instagram'}
              {platform === 'youtube' && '📺 YouTube'}
            </button>
          ))}
        </div>
      </div>

      {/* Series (optional) */}
      <div className="mb-4">
        <label htmlFor="series" className="block text-sm font-medium text-gray-700 mb-2">
          Series (optional)
        </label>
        <input
          type="text"
          id="series"
          value={seriesId}
          onChange={(e) => setSeriesId(e.target.value)}
          placeholder="Series UUID"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {/* Success */}
      {success && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-lg p-3">
          <p className="text-sm text-green-800">✅ Video created!</p>
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={loading || platforms.length === 0}
        className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium rounded-lg transition-colors"
      >
        {loading ? 'Creating...' : 'Create Video'}
      </button>
    </form>
  );
}
