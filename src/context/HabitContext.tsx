import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import confetti from 'canvas-confetti';
import {
  db,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  onSnapshot,
  handleFirestoreError,
  OperationType,
} from '../lib/firebase';
import { Habit, HabitCategory, HabitLog, TimeOfDay } from '../types';
import { useAuth } from './AuthContext';
import { sound } from '../utils/sound';

interface HabitContextType {
  habits: Habit[];
  logs: HabitLog[];
  loading: boolean;
  createHabit: (data: Omit<Habit, 'id' | 'userId' | 'streak' | 'bestStreak' | 'completedToday' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  updateHabit: (id: string, data: Partial<Habit>) => Promise<void>;
  deleteHabit: (id: string) => Promise<void>;
  toggleCompleteHabit: (id: string, dateStr?: string) => Promise<void>;
  undoCompleteHabit: (id: string, dateStr?: string) => Promise<void>;
  todayCompletedCount: number;
  todayTotalCount: number;
  todayCompletionRate: number;
  currentBestStreak: number;
  recentLogsSummary: string;
}

const HabitContext = createContext<HabitContextType | undefined>(undefined);

// Helper to get formatted local YYYY-MM-DD
export function getLocalDateString(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const STARTER_HABITS: Array<Omit<Habit, 'id' | 'userId' | 'streak' | 'bestStreak' | 'completedToday' | 'createdAt' | 'updatedAt'>> = [
  {
    title: 'Hydrate: Drink 500ml Water',
    description: 'Kickstart metabolic rate and mental clarity',
    category: 'health',
    frequency: 'daily',
    targetDaysPerWeek: 7,
    timeOfDay: 'morning',
    color: '#06b6d4',
    icon: 'droplet',
  },
  {
    title: 'Deep Focus Block (45 mins)',
    description: 'Work uninterrupted on top priority project',
    category: 'productivity',
    frequency: 'daily',
    targetDaysPerWeek: 5,
    timeOfDay: 'morning',
    color: '#8b5cf6',
    icon: 'zap',
  },
  {
    title: 'Evening Reading / Journaling (15 mins)',
    description: 'Read non-fiction or reflect before sleep',
    category: 'mindfulness',
    frequency: 'daily',
    targetDaysPerWeek: 7,
    timeOfDay: 'evening',
    color: '#10b981',
    icon: 'book-open',
  },
];

export const HabitProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, profile, updateProfileSettings } = useAuth();
  const [habits, setHabits] = useState<Habit[]>([]);
  const [logs, setLogs] = useState<HabitLog[]>([]);
  const [loading, setLoading] = useState(true);

  const today = getLocalDateString();

  // Listen to habits and logs in real-time
  useEffect(() => {
    if (!user) {
      setHabits([]);
      setLogs([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const habitsCol = collection(db, 'users', user.uid, 'habits');
    const logsCol = collection(db, 'users', user.uid, 'logs');

    let seeded = false;

    const unsubHabits = onSnapshot(
      habitsCol,
      async (snapshot) => {
        const loadedHabits: Habit[] = [];
        snapshot.forEach((docSnap) => {
          loadedHabits.push(docSnap.data() as Habit);
        });

        // Seed starters if first time user has zero habits
        if (loadedHabits.length === 0 && !seeded) {
          seeded = true;
          for (const starter of STARTER_HABITS) {
            const id = 'hab_' + Math.random().toString(36).substring(2, 9);
            const now = new Date().toISOString();
            const habitDoc: Habit = {
              ...starter,
              id,
              userId: user.uid,
              streak: 0,
              bestStreak: 0,
              completedToday: false,
              archived: false,
              createdAt: now,
              updatedAt: now,
            };
            try {
              await setDoc(doc(db, 'users', user.uid, 'habits', id), habitDoc);
            } catch (e) {
              console.error('Seeding error:', e);
            }
          }
          return;
        }

        setHabits(loadedHabits.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
        setLoading(false);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/habits`);
        setLoading(false);
      }
    );

    const unsubLogs = onSnapshot(
      logsCol,
      (snapshot) => {
        const loadedLogs: HabitLog[] = [];
        snapshot.forEach((docSnap) => {
          loadedLogs.push(docSnap.data() as HabitLog);
        });
        setLogs(loadedLogs);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, `users/${user.uid}/logs`);
      }
    );

    return () => {
      unsubHabits();
      unsubLogs();
    };
  }, [user]);

  // Derived state
  const todayHabitIdsCompleted = useMemo(() => {
    return new Set(
      logs
        .filter((l) => l.date === today && l.completed)
        .map((l) => l.habitId)
    );
  }, [logs, today]);

  // Sync completedToday property based on today's logs
  const syncedHabits = useMemo(() => {
    return habits.map((h) => ({
      ...h,
      completedToday: todayHabitIdsCompleted.has(h.id),
    }));
  }, [habits, todayHabitIdsCompleted]);

  const activeHabits = useMemo(() => {
    return syncedHabits.filter((h) => !h.archived);
  }, [syncedHabits]);

  const todayCompletedCount = activeHabits.filter((h) => h.completedToday).length;
  const todayTotalCount = activeHabits.length;
  const todayCompletionRate =
    todayTotalCount > 0 ? Math.round((todayCompletedCount / todayTotalCount) * 100) : 0;

  const currentBestStreak = useMemo(() => {
    return activeHabits.reduce((max, h) => Math.max(max, h.streak || 0), 0);
  }, [activeHabits]);

  const recentLogsSummary = useMemo(() => {
    return activeHabits
      .map((h) => `${h.title}: ${h.completedToday ? 'Completed today' : 'Pending'} (Streak: ${h.streak}d)`)
      .join(', ');
  }, [activeHabits]);

  const createHabit = async (
    data: Omit<Habit, 'id' | 'userId' | 'streak' | 'bestStreak' | 'completedToday' | 'createdAt' | 'updatedAt'>
  ) => {
    if (!user) return;
    const id = 'hab_' + Math.random().toString(36).substring(2, 9);
    const now = new Date().toISOString();
    const newHabit: Habit = {
      ...data,
      id,
      userId: user.uid,
      streak: 0,
      bestStreak: 0,
      completedToday: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await setDoc(doc(db, 'users', user.uid, 'habits', id), newHabit);
      sound.playClick();
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `users/${user.uid}/habits/${id}`);
    }
  };

  const updateHabit = async (id: string, data: Partial<Habit>) => {
    if (!user) return;
    try {
      const habitRef = doc(db, 'users', user.uid, 'habits', id);
      const updatePayload = {
        ...data,
        updatedAt: new Date().toISOString(),
      };
      await updateDoc(habitRef, updatePayload);
      sound.playClick();
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}/habits/${id}`);
    }
  };

  const deleteHabit = async (id: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'habits', id));
      sound.playClick();
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `users/${user.uid}/habits/${id}`);
    }
  };

  const toggleCompleteHabit = async (id: string, dateStr: string = today) => {
    if (!user) return;
    const habit = syncedHabits.find((h) => h.id === id);
    if (!habit) return;

    const isCurrentlyDone =
      dateStr === today
        ? todayHabitIdsCompleted.has(id)
        : logs.some((l) => l.habitId === id && l.date === dateStr && l.completed);
    const logDocId = `${id}_${dateStr}`;
    const logRef = doc(db, 'users', user.uid, 'logs', logDocId);
    const habitRef = doc(db, 'users', user.uid, 'habits', id);

    if (isCurrentlyDone) {
      // Undo completion
      try {
        await deleteDoc(logRef);
        const newStreak = Math.max(0, habit.streak - 1);
        await updateDoc(habitRef, {
          streak: newStreak,
          completedToday: false,
          updatedAt: new Date().toISOString(),
        });
        sound.playClick();
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `users/${user.uid}/logs/${logDocId}`);
      }
    } else {
      // Mark as complete
      try {
        const log: HabitLog = {
          id: logDocId,
          userId: user.uid,
          habitId: id,
          date: dateStr,
          completed: true,
          timestamp: new Date().toISOString(),
        };
        await setDoc(logRef, log);

        const newStreak = (habit.streak || 0) + 1;
        const newBestStreak = Math.max(habit.bestStreak || 0, newStreak);

        await updateDoc(habitRef, {
          streak: newStreak,
          bestStreak: newBestStreak,
          completedToday: true,
          updatedAt: new Date().toISOString(),
        });

        // Play pleasant sound
        sound.playCheck();

        // Check if all today habits are finished
        const remainingToComplete = activeHabits.filter((h) => h.id !== id && !h.completedToday).length;
        if (remainingToComplete === 0) {
          sound.playFanfare();
          try {
            confetti({
              particleCount: 80,
              spread: 70,
              origin: { y: 0.6 },
              colors: ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b'],
            });
          } catch {
            // Confetti is optional visual flair
          }
        }

        // Award XP to user profile
        if (profile) {
          const addedXp = 25 + (newStreak >= 3 ? 15 : 0);
          const totalXp = (profile.xp || 0) + addedXp;
          const newLevel = Math.floor(totalXp / 200) + 1;
          await updateProfileSettings({
            xp: totalXp,
            level: newLevel,
          });
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}/logs/${logDocId}`);
      }
    }
  };

  const undoCompleteHabit = async (id: string, dateStr: string = today) => {
    return toggleCompleteHabit(id, dateStr);
  };

  return (
    <HabitContext.Provider
      value={{
        habits: activeHabits,
        logs,
        loading,
        createHabit,
        updateHabit,
        deleteHabit,
        toggleCompleteHabit,
        undoCompleteHabit,
        todayCompletedCount,
        todayTotalCount,
        todayCompletionRate,
        currentBestStreak,
        recentLogsSummary,
      }}
    >
      {children}
    </HabitContext.Provider>
  );
};

export const useHabits = () => {
  const context = useContext(HabitContext);
  if (!context) {
    throw new Error('useHabits must be used within a HabitProvider');
  }
  return context;
};
