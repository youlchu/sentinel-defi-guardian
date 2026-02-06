import React, { useState } from 'react';
import { Menu, X, Home, BarChart3, Settings, User, Wallet } from 'lucide-react';

interface NavigationItem {
  label: string;
  icon: React.ComponentType<any>;
  href: string;
  active?: boolean;
}

interface DashboardLayoutProps {
  children?: React.ReactNode;
}

interface SidebarState {
  isOpen: boolean;
}

const navigationItems: NavigationItem[] = [
  { label: 'Dashboard', icon: Home, href: '/dashboard', active: true },
  { label: 'Analytics', icon: BarChart3, href: '/analytics' },
  { label: 'Profile', icon: User, href: '/profile' },
  { label: 'Settings', icon: Settings, href: '/settings' }
];

export default function Component({ children }: DashboardLayoutProps) {
  const [sidebarState, setSidebarState] = useState<SidebarState>({ isOpen: false });

  const toggleSidebar = () => {
    setSidebarState({ isOpen: !sidebarState.isOpen });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200 fixed top-0 left-0 right-0 z-30">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center">
            <button
              onClick={toggleSidebar}
              className="p-2 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 lg:hidden"
              aria-label="Toggle sidebar"
            >
              {sidebarState.isOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
            <h1 className="ml-2 text-xl font-semibold text-gray-900 lg:ml-0">
              Dashboard
            </h1>
          </div>
          
          {/* Wallet Connect Placeholder */}
          <div className="flex items-center space-x-4">
            <button className="flex items-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2">
              <Wallet size={18} />
              <span className="hidden sm:block">Connect Wallet</span>
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Overlay */}
      {sidebarState.isOpen && (
        <div 
          className="fixed inset-0 z-20 bg-black bg-opacity-50 lg:hidden"
          onClick={toggleSidebar}
        ></div>
      )}

      {/* Sidebar */}
      <aside className={`fixed top-0 left-0 z-40 w-64 h-screen pt-16 transition-transform bg-white border-r border-gray-200 ${
        sidebarState.isOpen ? 'translate-x-0' : '-translate-x-full'
      } lg:translate-x-0`}>
        <div className="h-full px-3 py-4 overflow-y-auto">
          <nav className="space-y-2">
            {navigationItems.map((item, index) => {
              const IconComponent = item.icon;
              return (
                <a
                  key={index}
                  href={item.href}
                  className={`flex items-center p-2 text-gray-900 rounded-lg hover:bg-gray-100 group transition-colors ${
                    item.active ? 'bg-blue-50 text-blue-700 border-r-2 border-blue-700' : ''
                  }`}
                  onClick={(e) => {
                    e.preventDefault();
                    setSidebarState({ isOpen: false });
                  }}
                >
                  <IconComponent className={`w-5 h-5 transition duration-75 ${
                    item.active ? 'text-blue-700' : 'text-gray-500 group-hover:text-gray-900'
                  }`} />
                  <span className="ml-3">{item.label}</span>
                </a>
              );
            })}
          </nav>
        </div>
      </aside>

      {/* Main Content */}
      <main className="pt-16 lg:ml-64">
        <div className="p-4 sm:p-6 lg:p-8">
          {children || (
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">
                Welcome to your Dashboard
              </h2>
              <p className="text-gray-600">
                This is the main content area. Your dashboard content will appear here.
              </p>
              
              {/* Sample Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 mt-6">
                <div className="bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg p-6 text-white">
                  <h3 className="text-lg font-semibold mb-2">Total Balance</h3>
                  <p className="text-2xl font-bold">$0.00</p>
                </div>
                <div className="bg-gradient-to-r from-green-500 to-teal-600 rounded-lg p-6 text-white">
                  <h3 className="text-lg font-semibold mb-2">Active Positions</h3>
                  <p className="text-2xl font-bold">0</p>
                </div>
                <div className="bg-gradient-to-r from-orange-500 to-red-600 rounded-lg p-6 text-white">
                  <h3 className="text-lg font-semibold mb-2">Portfolio Value</h3>
                  <p className="text-2xl font-bold">$0.00</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}