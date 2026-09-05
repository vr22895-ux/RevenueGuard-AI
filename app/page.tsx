import { redirect } from 'next/navigation';

// Landing page — redirects to dashboard
// In a real product, this would be a marketing page.
// For the buildathon, the dashboard IS the product.
export default function Home() {
  redirect('/dashboard');
}
