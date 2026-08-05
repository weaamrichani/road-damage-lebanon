'use client';

import dynamic from 'next/dynamic';

const RoadHealthDashboard = dynamic(
  () => import('./components/RoadHealthDashboard'),
  { ssr: false }
);

export default function Home() {
  return <RoadHealthDashboard />;
}