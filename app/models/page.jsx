import DashboardShell from '../../components/DashboardShell.jsx';
import ModelPanel from '../../components/ModelPanel.jsx';

export default function ModelsPage() {
  return (
    <DashboardShell active="models">
      <ModelPanel />
    </DashboardShell>
  );
}
