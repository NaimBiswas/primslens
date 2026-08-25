import DashboardShell from '../../components/DashboardShell.jsx';
import ActivityPanel from '../../components/ActivityPanel.jsx';

export default function ActivityPage() {
  return (
    <DashboardShell active="activity">
      <ActivityPanel />
    </DashboardShell>
  );
}
