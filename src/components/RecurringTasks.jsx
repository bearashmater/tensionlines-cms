import { useState, useEffect } from 'react';

export default function RecurringTasks() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // all, daily, weekly, monthly, quarterly, yearly
  const [assigneeFilter, setAssigneeFilter] = useState('all');

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 120000);
    return () => clearInterval(interval);
  }, []);

  const fetchTasks = async () => {
    try {
      const res = await fetch('http://localhost:3001/api/recurring-tasks');
      const data = await res.json();
      setTasks(data.recurringTasks || []);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching recurring tasks:', error);
      setLoading(false);
    }
  };

  const getTimeUntil = (dueDate) => {
    const now = new Date();
    const due = new Date(dueDate);
    const diff = due - now;

    if (diff < 0) return { text: 'OVERDUE', urgent: true };

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);

    if (days > 0) return { text: `in ${days} day${days > 1 ? 's' : ''}`, urgent: false };
    if (hours > 0) return { text: `in ${hours} hour${hours > 1 ? 's' : ''}`, urgent: hours < 3 };
    return { text: 'due soon', urgent: true };
  };

  const getStatusColor = (status) => {
    const colors = {
      active: '#7BA883',
      blocked: '#C97064',
      pending: '#6B6460'
    };
    return colors[status] || '#D4A574';
  };

  const getFrequencyIcon = (frequency) => {
    const icons = {
      daily: '📅',
      weekly: '🗓️',
      monthly: '📆',
      quarterly: '📊',
      yearly: '🎯'
    };
    return icons[frequency] || '🔁';
  };

  const filteredTasks = tasks.filter(task => {
    if (filter !== 'all' && task.frequency !== filter) return false;
    if (assigneeFilter !== 'all' && task.assignee !== assigneeFilter) return false;
    return true;
  });

  // Group by frequency
  const grouped = {
    daily: filteredTasks.filter(t => t.frequency === 'daily'),
    weekly: filteredTasks.filter(t => t.frequency === 'weekly'),
    monthly: filteredTasks.filter(t => t.frequency === 'monthly'),
    quarterly: filteredTasks.filter(t => t.frequency === 'quarterly'),
    yearly: filteredTasks.filter(t => t.frequency === 'yearly')
  };

  const uniqueAssignees = ['all', ...new Set(tasks.map(t => t.assignee))];

  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="animate-pulse text-lg">Loading recurring tasks...</div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-serif font-bold text-gray-900 mb-2">
          🔁 Recurring Tasks
        </h1>
        <p className="text-gray-600">
          Operational tasks that repeat (daily posts, weekly reviews, etc.)
        </p>
      </div>

      {/* Filters */}
      <div className="mb-6 flex gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Frequency
          </label>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-4 py-2 bg-white"
          >
            <option value="all">All Frequencies</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="yearly">Yearly</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Assignee
          </label>
          <select
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-4 py-2 bg-white"
          >
            {uniqueAssignees.map(a => (
              <option key={a} value={a}>
                {a === 'all' ? 'All Agents' : a}
              </option>
            ))}
          </select>
        </div>

        <div className="ml-auto flex items-end">
          <div className="text-sm text-gray-600">
            {filteredTasks.length} task{filteredTasks.length !== 1 ? 's' : ''}
          </div>
        </div>
      </div>

      {/* Task Groups */}
      <div className="space-y-8">
        {Object.entries(grouped).map(([frequency, freqTasks]) => {
          if (freqTasks.length === 0) return null;

          return (
            <div key={frequency}>
              <h2 className="text-xl font-semibold text-gray-800 mb-4 capitalize flex items-center gap-2">
                {getFrequencyIcon(frequency)} {frequency} ({freqTasks.length})
              </h2>

              <div className="space-y-3">
                {freqTasks.map(task => {
                  const timeUntil = getTimeUntil(task.nextDue);
                  const statusColor = getStatusColor(task.status);

                  return (
                    <div
                      key={task.id}
                      className="bg-white border-l-4 rounded-lg shadow-sm p-4 hover:shadow-md transition-shadow"
                      style={{ borderLeftColor: statusColor }}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <h3 className="font-semibold text-gray-900">
                          {task.name}
                        </h3>
                        <span
                          className={`px-3 py-1 rounded-full text-sm font-medium ${
                            timeUntil.urgent
                              ? 'bg-red-100 text-red-700'
                              : 'bg-blue-100 text-blue-700'
                          }`}
                        >
                          {timeUntil.text}
                        </span>
                      </div>

                      <p className="text-gray-600 text-sm mb-3">
                        {task.description}
                      </p>

                      <div className="flex flex-wrap gap-4 text-sm text-gray-500">
                        <span>👤 {task.assignee}</span>
                        <span>📅 {task.schedule}</span>
                        <span>
                          {task.automationType === 'cron' ? '⚙️ Automated' : '🖐️ Manual'}
                        </span>
                        <span
                          className="px-2 py-1 rounded"
                          style={{
                            backgroundColor: `${statusColor}20`,
                            color: statusColor
                          }}
                        >
                          {task.status}
                        </span>
                      </div>

                      {task.blockedReason && (
                        <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                          🚫 {task.blockedReason}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {filteredTasks.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          No recurring tasks match your filters.
        </div>
      )}
    </div>
  );
}
