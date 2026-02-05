import { useState, useEffect } from 'react'
import { Calendar, Clock, CheckCircle, AlertCircle, Loader } from 'lucide-react'
import useSWR from 'swr'
import { fetcher } from '../lib/api'

export default function PostingSchedule() {
  const { data: schedule, error, isLoading } = useSWR('/api/schedule', fetcher, {
    refreshInterval: 120000
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader className="animate-spin text-gold" size={32} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <p className="text-red-800">Failed to load schedule: {error.message}</p>
      </div>
    )
  }

  const currentHour = new Date().getHours()
  const currentMinute = new Date().getMinutes()

  // Helper to check if a time has passed today
  const hasTimePassed = (timeStr) => {
    const match = timeStr.match(/(\d+):(\d+)\s+(AM|PM)/)
    if (!match) return false
    
    let [_, hours, minutes, period] = match
    hours = parseInt(hours)
    minutes = parseInt(minutes)
    
    if (period === 'PM' && hours !== 12) hours += 12
    if (period === 'AM' && hours === 12) hours = 0
    
    if (hours < currentHour) return true
    if (hours === currentHour && minutes <= currentMinute) return true
    return false
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-serif font-bold text-black mb-2">
          Posting Schedule
        </h1>
        <p className="text-neutral-600">
          Automated daily content distribution across all platforms
        </p>
      </div>

      {/* Daily Schedule Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Today's Schedule */}
        <div className="bg-white rounded-lg border border-neutral-200 p-6">
          <div className="flex items-center space-x-2 mb-4">
            <Calendar className="text-gold" size={20} />
            <h2 className="text-lg font-serif font-semibold text-black">
              Today's Posts (Mon-Sat)
            </h2>
          </div>
          
          <div className="space-y-3">
            {schedule?.dailySchedule?.length > 0 ? (
              schedule.dailySchedule.map((item, idx) => {
                const passed = hasTimePassed(item.time)
                return (
                  <div
                    key={idx}
                    className={`flex items-start space-x-3 p-3 rounded-md ${
                      passed ? 'bg-neutral-50' : 'bg-cream'
                    }`}
                  >
                    <div className="flex-shrink-0 mt-1">
                      {passed ? (
                        <CheckCircle className="text-green-600" size={20} />
                      ) : (
                        <Clock className="text-gold" size={20} />
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className={`font-medium ${
                          passed ? 'text-neutral-500' : 'text-black'
                        }`}>
                          {item.time}
                        </span>
                        {passed && (
                          <span className="text-xs text-green-600 font-medium">
                            Posted
                          </span>
                        )}
                      </div>
                      <p className={`text-sm mt-1 ${
                        passed ? 'text-neutral-400' : 'text-neutral-600'
                      }`}>
                        {item.description}
                      </p>
                    </div>
                  </div>
                )
              })
            ) : (
              <p className="text-neutral-500 text-sm">No posts scheduled for today</p>
            )}
          </div>
        </div>

        {/* Engagement Bots */}
        <div className="bg-white rounded-lg border border-neutral-200 p-6">
          <div className="flex items-center space-x-2 mb-4">
            <AlertCircle className="text-gold" size={20} />
            <h2 className="text-lg font-serif font-semibold text-black">
              Continuous Automation
            </h2>
          </div>
          
          <div className="space-y-4">
            <div className="p-3 bg-cream rounded-md">
              <h3 className="font-medium text-black mb-1">Twitter Engagement Bot</h3>
              <p className="text-sm text-neutral-600 mb-2">
                Auto-replies to mentions and interactions
              </p>
              <div className="flex items-center space-x-2">
                <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse"></div>
                <span className="text-xs text-neutral-500">
                  Running every :11 and :56 past the hour
                </span>
              </div>
            </div>

            <div className="p-3 bg-cream rounded-md">
              <h3 className="font-medium text-black mb-1">Bluesky Engagement Bot</h3>
              <p className="text-sm text-neutral-600 mb-2">
                Auto-replies to mentions and interactions
              </p>
              <div className="flex items-center space-x-2">
                <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse"></div>
                <span className="text-xs text-neutral-500">
                  Running every :11 and :56 past the hour
                </span>
              </div>
            </div>

            <div className="p-3 bg-cream rounded-md">
              <h3 className="font-medium text-black mb-1">Daily Cron Jobs</h3>
              <p className="text-sm text-neutral-600">
                Patreon check, Reddit moderation, CMS review - all at 9:00 AM
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Weekly Schedule */}
      <div className="bg-white rounded-lg border border-neutral-200 p-6">
        <h2 className="text-lg font-serif font-semibold text-black mb-4">
          Weekly Cadence
        </h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <ScheduleCard
            day="Sunday"
            items={[
              { time: '5:00 PM', task: 'Patreon weekly update (Marcus)' },
              { time: '10:30 PM', task: 'Weekly content planning' },
              { time: '10:30 PM', task: 'Nightly compound review' }
            ]}
          />
          
          <ScheduleCard
            day="Monday - Saturday"
            items={[
              { time: '9:00 AM', task: 'Twitter post (Nietzsche)' },
              { time: '9:00 AM', task: 'Patreon check (Marcus)' },
              { time: '9:00 AM', task: 'Reddit check (Diogenes)' },
              { time: '10:00 AM', task: 'Bluesky post (Heraclitus)' },
              { time: '10:30 PM', task: 'Nightly compound review' }
            ]}
          />
          
          <ScheduleCard
            day="Content Rotation"
            items={[
              { day: 'Mon', task: 'Core Principle' },
              { day: 'Tue', task: 'Parable/Story' },
              { day: 'Wed', task: 'Practical Tool' },
              { day: 'Thu', task: 'Question/Provocation' },
              { day: 'Fri', task: 'Community/Reflection' },
              { day: 'Sat', task: 'Behind-the-scenes' }
            ]}
          />
        </div>
      </div>

      {/* Platform Status */}
      <div className="bg-white rounded-lg border border-neutral-200 p-6">
        <h2 className="text-lg font-serif font-semibold text-black mb-4">
          Platform Status
        </h2>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <PlatformStatus platform="Twitter/X" status="active" handle="@thetensionlines" />
          <PlatformStatus platform="Bluesky" status="active" handle="thetensionlines.bsky.social" />
          <PlatformStatus platform="Reddit" status="active" handle="r/thetensionlines" />
          <PlatformStatus platform="Patreon" status="active" handle="patreon.com/thetensionlines" />
          <PlatformStatus platform="Threads" status="pending" handle="@thetensionlines" />
          <PlatformStatus platform="Instagram" status="pending" handle="@thetensionlines" />
          <PlatformStatus platform="Medium" status="pending" handle="@thetensionlines" />
          <PlatformStatus platform="Newsletter" status="pending" handle="thetensionlines.substack.com" />
        </div>
      </div>

      {/* Last Updated */}
      {schedule?.lastUpdated && (
        <div className="text-center text-sm text-neutral-500">
          Schedule last updated: {new Date(schedule.lastUpdated).toLocaleString()}
        </div>
      )}
    </div>
  )
}

function ScheduleCard({ day, items }) {
  return (
    <div className="p-4 bg-cream rounded-lg border border-neutral-200">
      <h3 className="font-medium text-black mb-3">{day}</h3>
      <div className="space-y-2">
        {items.map((item, idx) => (
          <div key={idx} className="text-sm">
            <span className="text-neutral-600">
              {item.time || item.day}:
            </span>
            <span className="text-neutral-800 ml-2">
              {item.task}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function PlatformStatus({ platform, status, handle }) {
  return (
    <div className="p-3 bg-cream rounded-lg">
      <div className="flex items-center space-x-2 mb-1">
        <div className={`h-2 w-2 rounded-full ${
          status === 'active' ? 'bg-green-500' : 'bg-yellow-500'
        }`}></div>
        <h4 className="font-medium text-black text-sm">{platform}</h4>
      </div>
      <p className="text-xs text-neutral-600 truncate">{handle}</p>
      <p className="text-xs text-neutral-500 mt-1">
        {status === 'active' ? 'Live' : 'Pending setup'}
      </p>
    </div>
  )
}
