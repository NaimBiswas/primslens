import DashboardShell from '../../components/DashboardShell.jsx';
import AutomationPanel from '../../components/AutomationPanel.jsx';

export default function AutomationPage() {
  return (
    <DashboardShell active="automation">
      <AutomationPanel />
    </DashboardShell>
  );
}
