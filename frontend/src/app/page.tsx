import Link from 'next/link'

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      <div className="max-w-4xl mx-auto text-center">
        {/* Hero Section */}
        <div className="mb-12">
          <h1 className="text-6xl font-bold mb-4">
            <span className="bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
              SENTINEL
            </span>
          </h1>
          <p className="text-2xl text-gray-300 mb-2">
            Autonomous DeFi Risk Guardian
          </p>
          <p className="text-gray-400">
            Real-time liquidation protection for Solana DeFi positions
          </p>
        </div>

        {/* Features */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700">
            <div className="text-4xl mb-4">🛡️</div>
            <h3 className="text-xl font-semibold mb-2">Liquidation Protection</h3>
            <p className="text-gray-400 text-sm">
              30+ minute early warning system for impending liquidations
            </p>
          </div>
          
          <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700">
            <div className="text-4xl mb-4">📊</div>
            <h3 className="text-xl font-semibold mb-2">Multi-Protocol</h3>
            <p className="text-gray-400 text-sm">
              Monitors Marginfi, Kamino, and Drift positions
            </p>
          </div>
          
          <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700">
            <div className="text-4xl mb-4">🤖</div>
            <h3 className="text-xl font-semibold mb-2">AI-Powered</h3>
            <p className="text-gray-400 text-sm">
              ML-based risk scoring and prediction engine
            </p>
          </div>
        </div>

        {/* CTA */}
        <Link 
          href="/dashboard"
          className="inline-block bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-semibold px-8 py-4 rounded-xl transition-all transform hover:scale-105"
        >
          Launch Dashboard →
        </Link>

        {/* Agent Info */}
        <div className="mt-16 text-gray-500 text-sm">
          <p>Built by <span className="text-indigo-400">mrrobot</span> (#472)</p>
          <p>Colosseum Agent Hackathon 2026</p>
        </div>
      </div>
    </main>
  )
}