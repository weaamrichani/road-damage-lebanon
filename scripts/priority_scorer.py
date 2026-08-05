"""
Priority Scoring Engine for Road Repair Prioritization

Converts detected road damages into a composite priority score that tells municipalities
"which roads should be repaired first and why?"

Scoring formula:
  composite_priority = (0.35 * damage_severity) + (0.30 * damage_frequency) + 
                       (0.20 * road_importance) + (0.15 * user_reports)
"""

from dataclasses import dataclass
from typing import Dict, List, Tuple
from datetime import datetime, timedelta


@dataclass
class DamageDetection:
    """A single detected damage instance."""
    damage_class: str  # 'D00', 'D10', 'D20', 'D40'
    confidence: float  # 0-1
    detected_at: datetime


@dataclass
class RoadSegment:
    """A single road segment to be scored."""
    segment_id: str
    name: str
    road_type: str  # 'primary', 'secondary', 'tertiary', 'residential'
    detections: List[DamageDetection]
    user_severity_ratings: List[int]  # User reports: 1-5 scale
    last_detection_days_ago: int


class PriorityScorer:
    """
    Compute composite priority scores for road segments.
    """
    
    # ============================================
    # DAMAGE CLASS SEVERITY WEIGHTS
    # ============================================
    # Higher = more urgent to fix
    DAMAGE_SEVERITY = {
        'D00': 1.0,  # Longitudinal crack - minor
        'D10': 1.5,  # Transverse crack - moderate
        'D20': 2.5,  # Alligator crack - structural deterioration
        'D40': 3.0   # Pothole - immediate danger, highest priority
    }
    
    # ============================================
    # ROAD IMPORTANCE WEIGHTS
    # ============================================
    # Higher = more critical to maintain
    ROAD_IMPORTANCE = {
        'primary': 1.5,      # Highways, main arteries
        'secondary': 1.2,    # Regional roads
        'tertiary': 1.0,     # Local connectors
        'residential': 0.8   # Residential streets
    }
    
    # ============================================
    # RECENCY FACTOR
    # ============================================
    # Recent damage = higher priority (more active deterioration)
    # Older damage = lower priority (but still needs repair)
    RECENCY_WINDOW_DAYS = 30  # Consider detections within last 30 days as "recent"
    
    def __init__(self):
        pass
    
    def compute_damage_severity_score(self, detections: List[DamageDetection]) -> float:
        """
        Severity component (0-100).
        
        Higher severity classes (potholes, alligator cracks) boost score more.
        Multiple instances compound the score (more damage = higher urgency).
        Confidence weights the score (low-confidence detections matter less).
        
        Returns:
            Score 0-100
        """
        if not detections:
            return 0.0
        
        # Weight each detection by severity × confidence
        weighted_severity = sum(
            self.DAMAGE_SEVERITY.get(d.damage_class, 1.0) * d.confidence
            for d in detections
        )
        
        # Normalize by max possible (4 damages at D40 with 1.0 confidence)
        max_severity = 4 * self.DAMAGE_SEVERITY['D40']
        normalized = (weighted_severity / max_severity) * 100
        
        return min(normalized, 100.0)
    
    def compute_damage_frequency_score(self, detections: List[DamageDetection]) -> float:
        """
        Frequency component (0-100).
        
        More detected instances = higher score.
        Recency boost: recent detections (last 30 days) indicate active deterioration.
        
        Returns:
            Score 0-100
        """
        if not detections:
            return 0.0
        
        # Base score from count
        recent_count = sum(
            1 for d in detections 
            if self._days_since(d.detected_at) <= self.RECENCY_WINDOW_DAYS
        )
        
        total_count = len(detections)
        
        # Recent detections get higher weight (1.5x)
        weighted_count = recent_count * 1.5 + (total_count - recent_count) * 1.0
        
        # Normalize: threshold at 20 damages = max score
        normalized = (weighted_count / 20) * 100
        
        return min(normalized, 100.0)
    
    def compute_pothole_score(self, detections: List[DamageDetection]) -> float:
        """
        Pothole-specific sub-score (0-100).
        
        Potholes are the most dangerous (directly cause accidents, vehicle damage).
        Used as a separate signal in the dashboard.
        
        Returns:
            Score 0-100
        """
        pothole_detections = [d for d in detections if d.damage_class == 'D40']
        
        if not pothole_detections:
            return 0.0
        
        # Simple: count of potholes, normalized
        pothole_count = len(pothole_detections)
        normalized = (pothole_count / 10) * 100
        
        return min(normalized, 100.0)
    
    def compute_alligator_score(self, detections: List[DamageDetection]) -> float:
        """
        Alligator crack-specific sub-score (0-100).
        
        Alligator cracks indicate structural failure; expensive to fix but critical.
        
        Returns:
            Score 0-100
        """
        alligator_detections = [d for d in detections if d.damage_class == 'D20']
        
        if not alligator_detections:
            return 0.0
        
        alligator_count = len(alligator_detections)
        normalized = (alligator_count / 5) * 100  # Threshold lower (more serious)
        
        return min(normalized, 100.0)
    
    def compute_user_report_score(self, severity_ratings: List[int]) -> float:
        """
        User crowdsourced severity component (0-100).
        
        Average severity from user reports (1-5 scale).
        Encourages community input; validates automated detection.
        
        Returns:
            Score 0-100
        """
        if not severity_ratings:
            return 0.0
        
        avg_severity = sum(severity_ratings) / len(severity_ratings)
        # Scale 1-5 to 0-100
        normalized = ((avg_severity - 1) / 4) * 100
        
        return min(normalized, 100.0)
    
    def compute_road_importance_score(self, road_type: str) -> float:
        """
        Road importance component (0-100).
        
        Primary roads are critical infrastructure; damage there affects more people.
        
        Returns:
            Score 0-100 (based on road type)
        """
        multiplier = self.ROAD_IMPORTANCE.get(road_type, 1.0)
        return (multiplier / 1.5) * 100  # Normalize tertiary (1.0) to ~67
    
    def compute_composite_priority(self, segment: RoadSegment) -> Tuple[float, int]:
        """
        Compute final composite priority score (0-100) and assign tier.
        
        Composite formula:
          priority = (0.35 * damage_severity) + 
                     (0.30 * damage_frequency) +
                     (0.20 * road_importance) +
                     (0.15 * user_reports)
        
        Args:
            segment: RoadSegment with detections, ratings, road metadata
        
        Returns:
            (composite_priority: float 0-100, priority_tier: int 1-3)
        """
        severity = self.compute_damage_severity_score(segment.detections)
        frequency = self.compute_damage_frequency_score(segment.detections)
        importance = self.compute_road_importance_score(segment.road_type)
        user_reports = self.compute_user_report_score(segment.user_severity_ratings)
        
        # Weighted composite
        composite = (
            0.35 * severity +
            0.30 * frequency +
            0.20 * importance +
            0.15 * user_reports
        )
        
        # Assign tier based on composite score
        # Tier 1: Urgent (within month) = top 25% of roads with damage
        # Tier 2: High (next quarter) = next 25%
        # Tier 3: Monitor = rest
        if composite >= 60:
            tier = 1  # Urgent
        elif composite >= 40:
            tier = 2  # High
        else:
            tier = 3  # Monitor
        
        return composite, tier
    
    def score_segments(self, segments: List[RoadSegment]) -> List[Dict]:
        """
        Score all segments and return a ranked list.
        
        Args:
            segments: List of RoadSegment objects
        
        Returns:
            Sorted list of dicts with scores and metadata
        """
        results = []
        
        for segment in segments:
            composite, tier = self.compute_composite_priority(segment)
            
            severity = self.compute_damage_severity_score(segment.detections)
            pothole = self.compute_pothole_score(segment.detections)
            alligator = self.compute_alligator_score(segment.detections)
            user_report = self.compute_user_report_score(segment.user_severity_ratings)
            
            results.append({
                'segment_id': segment.segment_id,
                'name': segment.name,
                'road_type': segment.road_type,
                'composite_priority': round(composite, 2),
                'priority_tier': tier,
                'damage_count': len(segment.detections),
                'damage_severity_score': round(severity, 2),
                'pothole_score': round(pothole, 2),
                'alligator_score': round(alligator, 2),
                'user_report_score': round(user_report, 2),
                'last_detection_days_ago': segment.last_detection_days_ago,
                'repair_reasoning': self._generate_reasoning(segment, composite, tier)
            })
        
        # Sort by priority tier (1 first), then composite score (descending)
        results.sort(key=lambda x: (x['priority_tier'], -x['composite_priority']))
        
        return results
    
    def _generate_reasoning(self, segment: RoadSegment, composite: float, tier: int) -> str:
        """
        Generate a human-readable explanation for why a road got its priority.
        """
        damage_counts = {}
        for d in segment.detections:
            damage_counts[d.damage_class] = damage_counts.get(d.damage_class, 0) + 1
        
        parts = []
        
        # Damage breakdown
        if damage_counts.get('D40', 0) > 0:
            parts.append(f"{damage_counts['D40']} pothole(s)")
        if damage_counts.get('D20', 0) > 0:
            parts.append(f"{damage_counts['D20']} alligator crack(s)")
        if damage_counts.get('D10', 0) > 0:
            parts.append(f"{damage_counts['D10']} transverse crack(s)")
        if damage_counts.get('D00', 0) > 0:
            parts.append(f"{damage_counts['D00']} longitudinal crack(s)")
        
        reason = "Detected: " + ", ".join(parts)
        
        if segment.user_severity_ratings:
            avg_rating = sum(segment.user_severity_ratings) / len(segment.user_severity_ratings)
            reason += f" | User severity: {avg_rating:.1f}/5"
        
        if self.ROAD_IMPORTANCE[segment.road_type] > 1.0:
            reason += f" | {segment.road_type.capitalize()} road (high traffic)"
        
        if segment.last_detection_days_ago <= self.RECENCY_WINDOW_DAYS:
            reason += " | Recent damage detected"
        
        return reason
    
    def _days_since(self, dt: datetime) -> int:
        """Days between datetime and now."""
        return (datetime.now() - dt).days


# ============================================
# EXAMPLE USAGE
# ============================================

def example():
    scorer = PriorityScorer()
    
    # Example detections for two road segments
    segment1_detections = [
        DamageDetection('D40', 0.95, datetime.now() - timedelta(days=5)),  # Pothole, recent
        DamageDetection('D40', 0.87, datetime.now() - timedelta(days=3)),
        DamageDetection('D20', 0.92, datetime.now() - timedelta(days=10)),  # Alligator crack
    ]
    
    segment2_detections = [
        DamageDetection('D00', 0.78, datetime.now() - timedelta(days=25)),  # Old longitudinal crack
    ]
    
    segment1_ratings = [5, 4, 5]  # User reports: severe
    segment2_ratings = []  # No user reports
    
    segment1 = RoadSegment(
        segment_id="road_001",
        name="Damascus Road (Ras Beirut)",
        road_type="primary",
        detections=segment1_detections,
        user_severity_ratings=segment1_ratings,
        last_detection_days_ago=3
    )
    
    segment2 = RoadSegment(
        segment_id="road_002",
        name="Ashrafieh Access Road",
        road_type="residential",
        detections=segment2_detections,
        user_severity_ratings=segment2_ratings,
        last_detection_days_ago=25
    )
    
    # Score both
    segments = [segment1, segment2]
    results = scorer.score_segments(segments)
    
    print("🚗 Road Repair Priority Ranking")
    print("=" * 80)
    
    for i, result in enumerate(results, 1):
        tier_label = {1: "🔴 URGENT", 2: "🟡 HIGH", 3: "🟢 MONITOR"}[result['priority_tier']]
        
        print(f"\n#{i} {tier_label}")
        print(f"   Road: {result['name']}")
        print(f"   Priority Score: {result['composite_priority']}/100")
        print(f"   Damages: {result['damage_count']} detected")
        print(f"   Reasoning: {result['repair_reasoning']}")
        print(f"   —" * 40)


if __name__ == "__main__":
    example()
