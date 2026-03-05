'use client';

import dynamic from 'next/dynamic';

const LivenessCheck = dynamic(() => import('./LivenessCheck'), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  ),
});

export default function LivenessCheckWrapper() {
  return <LivenessCheck />;
}
