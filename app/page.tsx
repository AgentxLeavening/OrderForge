import { redirect } from 'next/navigation'

// The app is dashboard-first. Send the root URL to the dashboard, which itself
// redirects to /login when there's no authenticated user.
export default function Home() {
  redirect('/dashboard')
}
