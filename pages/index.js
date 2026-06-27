import { useEffect } from 'react';

export default function Home() {
  useEffect(() => {
    // The static index.html from /public is served at root by Next.js
    // This page only renders if /public/index.html wasn't matched
    window.location.href = '/index.html';
  }, []);
  return (
    <div style={{padding:40,fontFamily:'sans-serif',textAlign:'center'}}>
      <h2>Loading QuickCash Agency...</h2>
      <p><a href="/index.html">Click here if not redirected</a></p>
    </div>
  );
}
