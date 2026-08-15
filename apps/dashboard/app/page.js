'use client';

import { useState, useEffect } from 'react';
import CreateProductionForm from '../components/CreateProductionForm';
import ProductionsList from '../components/ProductionsList';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const BUSINESS_ID = process.env.NEXT_PUBLIC_BUSINESS_ID;

export default function Home() {
  const [productions, setProductions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch productions on mount
  useEffect(() => {
    fetchProductions();
  }, []);

  async function fetchProductions() {
    if (!BUSINESS_ID) {
      setError('Business ID not configured. Set NEXT_PUBLIC_BUSINESS_ID in .env');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`${API_URL}/api/productions?business_id=${BUSINESS_ID}`);
      if (!res.ok) throw new Error('Failed to fetch productions');
      const data = await res.json();
      setProductions(data);
      setError(null);
    } catch (err) {
      console.error('Error fetching productions:', err);
      setError('Failed to load productions. Is the API server running?');
    } finally {
      setLoading(false);
    }
  }

  function handleProductionCreated(newProduction) {
    setProductions([newProduction, ...productions]);
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-6">
      {/* Header */}
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Content Factory
        </h1>
        <p className="text-sm text-gray-600">
          Create TikTok videos from your iPhone
        </p>
      </header>

      {/* Create Form */}
      <section className="mb-8">
        <CreateProductionForm onCreated={handleProductionCreated} />
      </section>

      {/* Productions List */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Your Videos
        </h2>
        {loading ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
            <p className="text-gray-600 mt-2">Loading...</p>
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-800">{error}</p>
          </div>
        ) : productions.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-600">No videos yet. Create your first one!</p>
          </div>
        ) : (
          <ProductionsList productions={productions} onRefresh={fetchProductions} />
        )}
      </section>
    </main>
  );
}
