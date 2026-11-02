/**
 * Achievement tier display definitions (rules: ids, labels and colours the achievement manager and sheet read).
 * The achievements themselves are content (`../achievements.mjs`).
 */

export const COG_ACHIEVEMENT_TIERS = {
  bronze: {
    id: 'bronze',
    label: 'Bronze',
    color: '#cd7f32',
    bgColor: 'rgba(205, 127, 50, 0.15)',
    borderColor: '#cd7f32',
    icon: 'fa-solid fa-medal'
  },
  silver: {
    id: 'silver',
    label: 'Silver',
    color: '#bdc3c7',
    bgColor: 'rgba(189, 195, 199, 0.15)',
    borderColor: '#bdc3c7',
    icon: 'fa-solid fa-shield'
  },
  gold: {
    id: 'gold',
    label: 'Gold',
    color: '#f1c40f',
    bgColor: 'rgba(241, 196, 15, 0.15)',
    borderColor: '#f1c40f',
    icon: 'fa-solid fa-trophy'
  },
  platinum: {
    id: 'platinum',
    label: 'Platinum',
    color: '#00d2d3',
    bgColor: 'rgba(0, 210, 211, 0.15)',
    borderColor: '#00d2d3',
    icon: 'fa-solid fa-gem'
  },
  legendary: {
    id: 'legendary',
    label: 'Legendary',
    color: '#e67e22',
    bgColor: 'rgba(230, 126, 34, 0.15)',
    borderColor: '#e67e22',
    icon: 'fa-solid fa-dragon'
  },
  celestial: {
    id: 'celestial',
    label: 'Celestial',
    color: '#9b59b6',
    bgColor: 'rgba(155, 89, 182, 0.15)',
    borderColor: '#9b59b6',
    icon: 'fa-solid fa-crown'
  },
  quest: {
    id: 'quest',
    label: 'Quest',
    color: '#3498db',
    bgColor: 'rgba(52, 152, 219, 0.15)',
    borderColor: '#3498db',
    icon: 'fa-solid fa-map'
  },
  secret: {
    id: 'secret',
    label: 'Secret',
    color: '#1abc9c',
    bgColor: 'rgba(26, 188, 156, 0.15)',
    borderColor: '#1abc9c',
    icon: 'fa-solid fa-mask'
  },
  special: {
    id: 'special',
    label: 'Special',
    color: '#e74c3c',
    bgColor: 'rgba(231, 76, 60, 0.15)',
    borderColor: '#e74c3c',
    icon: 'fa-solid fa-award'
  }
};
