import EmissionTracking from './EmissionTracking';

export default async function EmissionTrackingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EmissionTracking jobId={id} />;
}
