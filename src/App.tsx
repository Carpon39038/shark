import { useViewStore } from '@/stores/viewStore';
import { Toolbar } from '@/components/Toolbar/Toolbar';
import { Sidebar } from '@/components/Sidebar/Sidebar';
import { VirtualGrid } from '@/components/Grid/VirtualGrid';
import { ImageViewer } from '@/components/Viewer/ImageViewer';
import { ImportProgress } from '@/components/Import/ImportProgress';

function App() {
  const sidebarOpen = useViewStore((s) => s.sidebarOpen);

  return (
    <div className="flex flex-col h-screen bg-neutral-900 text-white select-none">
      <Toolbar />
      <div className="flex flex-1 overflow-hidden">
        {sidebarOpen && <Sidebar />}
        <VirtualGrid />
      </div>
      <ImageViewer />
      <ImportProgress />
    </div>
  );
}

export default App;
