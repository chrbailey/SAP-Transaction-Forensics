"""
Risk Alerting System for Predictive Process Monitoring.

Provides configurable alerting based on predictive model outputs, enabling
proactive intervention in at-risk SAP O2C process instances. Supports
threshold-based alerts, trend detection, and alert aggregation.

Alert Types:
- Late delivery risk alerts
- Credit hold risk alerts
- SLA violation warnings
- Anomaly detection alerts

Alert Channels:
- In-memory alert queue
- Callback-based notifications
- Alert history tracking

References:
- Conforti, R., et al. (2015). Filtering out infrequent behavior from
  business process event logs. IEEE TKDE, 29(2), 300-314.
"""

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Set
from collections import deque

from .models import Prediction, PredictionType, ValueType
import warnings

logger = logging.getLogger(__name__)


class AlertSeverity(Enum):
    """Severity levels for alerts."""

    CRITICAL = "critical"  # Immediate action required
    HIGH = "high"          # Action required soon
    MEDIUM = "medium"      # Monitor closely
    LOW = "low"            # Informational
    INFO = "info"          # For tracking only

    def __lt__(self, other: "AlertSeverity") -> bool:
        """Enable sorting by severity."""
        order = {
            AlertSeverity.CRITICAL: 0,
            AlertSeverity.HIGH: 1,
            AlertSeverity.MEDIUM: 2,
            AlertSeverity.LOW: 3,
            AlertSeverity.INFO: 4,
        }
        return order[self] < order[other]


class AlertType(Enum):
    """Types of alerts that can be generated."""

    LATE_DELIVERY_RISK = "late_delivery_risk"
    CREDIT_HOLD_RISK = "credit_hold_risk"
    SLA_WARNING = "sla_warning"
    COMPLETION_DELAY = "completion_delay"
    PROCESS_ANOMALY = "process_anomaly"
    THRESHOLD_BREACH = "threshold_breach"


@dataclass
class AlertThreshold:
    """
    Configuration for an alert threshold.

    Attributes:
        alert_type: Type of alert this threshold triggers
        prediction_type: Associated prediction type
        threshold_value: Value that triggers the alert
        severity: Severity when threshold is breached
        comparison: How to compare ('gt', 'lt', 'gte', 'lte', 'eq')
        cooldown_minutes: Minimum time between alerts for same case
        description: Human-readable description of the threshold
    """
    alert_type: AlertType
    prediction_type: PredictionType
    threshold_value: float
    severity: AlertSeverity = AlertSeverity.HIGH
    comparison: str = "gt"  # gt, lt, gte, lte, eq
    cooldown_minutes: int = 60
    description: str = ""

    def check(self, value: float) -> bool:
        """
        Check if the value breaches this threshold.

        Args:
            value: Value to check

        Returns:
            True if threshold is breached
        """
        if self.comparison == "gt":
            return value > self.threshold_value
        elif self.comparison == "lt":
            return value < self.threshold_value
        elif self.comparison == "gte":
            return value >= self.threshold_value
        elif self.comparison == "lte":
            return value <= self.threshold_value
        elif self.comparison == "eq":
            return abs(value - self.threshold_value) < 1e-6
        return False


@dataclass
class Alert:
    """
    A generated alert for a process instance.

    Attributes:
        alert_id: Unique identifier for the alert
        case_id: Identifier for the process instance
        alert_type: Type of alert
        severity: Severity level
        prediction: The prediction that triggered this alert
        threshold: The threshold that was breached
        message: Human-readable alert message
        timestamp: When the alert was generated
        acknowledged: Whether the alert has been acknowledged
        acknowledged_by: Who acknowledged the alert
        acknowledged_at: When the alert was acknowledged
        metadata: Additional alert metadata
    """
    alert_id: str
    case_id: str
    alert_type: AlertType
    severity: AlertSeverity
    prediction: Prediction
    threshold: AlertThreshold
    message: str
    timestamp: datetime = field(default_factory=datetime.now)
    acknowledged: bool = False
    acknowledged_by: Optional[str] = None
    acknowledged_at: Optional[datetime] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    def acknowledge(self, user: str = "system") -> None:
        """
        Acknowledge the alert.

        Args:
            user: User or system that acknowledged the alert
        """
        self.acknowledged = True
        self.acknowledged_by = user
        self.acknowledged_at = datetime.now()

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary representation."""
        return {
            "alert_id": self.alert_id,
            "case_id": self.case_id,
            "alert_type": self.alert_type.value,
            "severity": self.severity.value,
            "prediction_type": self.prediction.prediction_type.value,
            "predicted_value": self.prediction.predicted_value,
            "probability": self.prediction.probability,
            "threshold_value": self.threshold.threshold_value,
            "message": self.message,
            "timestamp": self.timestamp.isoformat(),
            "acknowledged": self.acknowledged,
            "acknowledged_by": self.acknowledged_by,
            "acknowledged_at": self.acknowledged_at.isoformat()
            if self.acknowledged_at else None,
            "metadata": self.metadata,
        }


class AlertHandler(ABC):
    """
    Abstract base class for alert handlers.

    Handlers receive alerts and process them according to their implementation
    (e.g., logging, email, webhook, etc.).
    """

    @abstractmethod
    def handle(self, alert: Alert) -> None:
        """
        Handle an alert.

        Args:
            alert: The alert to handle
        """
        pass


class LoggingAlertHandler(AlertHandler):
    """
    Alert handler that logs alerts.

    Logs alerts to the configured logger with appropriate log levels
    based on alert severity.
    """

    def __init__(self, logger_name: str = "prediction.alerts"):
        """
        Initialize the logging handler.

        Args:
            logger_name: Name of the logger to use
        """
        self._logger = logging.getLogger(logger_name)

    def handle(self, alert: Alert) -> None:
        """Log the alert."""
        log_level = {
            AlertSeverity.CRITICAL: logging.CRITICAL,
            AlertSeverity.HIGH: logging.ERROR,
            AlertSeverity.MEDIUM: logging.WARNING,
            AlertSeverity.LOW: logging.INFO,
            AlertSeverity.INFO: logging.DEBUG,
        }.get(alert.severity, logging.INFO)

        self._logger.log(
            log_level,
            f"[{alert.alert_type.value}] Case {alert.case_id}: {alert.message}"
        )


class CallbackAlertHandler(AlertHandler):
    """
    Alert handler that calls a callback function.

    Useful for integrating with custom notification systems or
    triggering automated responses.
    """

    def __init__(self, callback: Callable[[Alert], None]):
        """
        Initialize the callback handler.

        Args:
            callback: Function to call with each alert
        """
        self._callback = callback

    def handle(self, alert: Alert) -> None:
        """Call the callback with the alert."""
        try:
            self._callback(alert)
        except Exception as e:
            logger.error(f"Alert callback failed: {e}")


class QueueAlertHandler(AlertHandler):
    """
    Alert handler that queues alerts for later processing.

    Maintains an in-memory queue of alerts that can be retrieved
    and processed by external systems.
    """

    def __init__(self, max_size: int = 1000):
        """
        Initialize the queue handler.

        Args:
            max_size: Maximum number of alerts to keep in queue
        """
        self._queue: deque = deque(maxlen=max_size)

    def handle(self, alert: Alert) -> None:
        """Add the alert to the queue."""
        self._queue.append(alert)

    def get_alerts(self, max_count: Optional[int] = None) -> List[Alert]:
        """
        Get alerts from the queue.

        Args:
            max_count: Maximum number of alerts to return

        Returns:
            List of alerts
        """
        if max_count is None:
            return list(self._queue)
        return list(self._queue)[:max_count]

    def clear(self) -> None:
        """Clear the alert queue."""
        self._queue.clear()

    @property
    def size(self) -> int:
        """Get the current queue size."""
        return len(self._queue)


@dataclass
class AlertConfig:
    """
    Configuration for the alert system.

    Attributes:
        late_delivery_threshold: Probability threshold for late delivery alerts
        credit_hold_threshold: Probability threshold for credit hold alerts
        sla_warning_hours: Hours before SLA to trigger warning
        enable_critical_alerts: Whether to generate critical alerts
        enable_cooldown: Whether to enforce alert cooldown periods
        default_cooldown_minutes: Default cooldown period
        max_alerts_per_case: Maximum alerts per case before throttling
    """
    late_delivery_threshold: float = 0.7
    credit_hold_threshold: float = 0.6
    sla_warning_hours: float = 24.0
    enable_critical_alerts: bool = True
    enable_cooldown: bool = True
    default_cooldown_minutes: int = 60
    max_alerts_per_case: int = 10


class AlertManager:
    """
    Manages alert generation, thresholds, and handlers.

    The AlertManager is the central component of the alerting system,
    responsible for evaluating predictions against thresholds and
    generating alerts when risk levels exceed configured limits.

    Example:
        from prediction.alerts import AlertManager, AlertConfig

        config = AlertConfig(late_delivery_threshold=0.7)
        manager = AlertManager(config)

        # Add handler
        manager.add_handler(LoggingAlertHandler())

        # Check prediction and generate alerts
        alerts = manager.check_prediction(prediction)
        for alert in alerts:
            print(f"Alert: {alert.message}")
    """

    def __init__(self, config: Optional[AlertConfig] = None):
        """
        Initialize the alert manager.

        Args:
            config: Alert configuration
        """
        self._config = config or AlertConfig()
        self._handlers: List[AlertHandler] = []
        self._thresholds: List[AlertThreshold] = []
        self._alert_history: Dict[str, List[Alert]] = {}
        self._cooldown_tracker: Dict[str, Dict[str, datetime]] = {}
        self._alert_counter = 0

        # Set up default thresholds
        self._setup_default_thresholds()

    def _setup_default_thresholds(self) -> None:
        """Set up default alert thresholds based on configuration."""
        # Late delivery alert
        self._thresholds.append(AlertThreshold(
            alert_type=AlertType.LATE_DELIVERY_RISK,
            prediction_type=PredictionType.LATE_DELIVERY,
            threshold_value=self._config.late_delivery_threshold,
            severity=AlertSeverity.HIGH,
            comparison="gte",
            cooldown_minutes=self._config.default_cooldown_minutes,
            description="High probability of late delivery detected",
        ))

        # Critical late delivery (higher threshold)
        if self._config.enable_critical_alerts:
            self._thresholds.append(AlertThreshold(
                alert_type=AlertType.LATE_DELIVERY_RISK,
                prediction_type=PredictionType.LATE_DELIVERY,
                threshold_value=0.9,
                severity=AlertSeverity.CRITICAL,
                comparison="gte",
                cooldown_minutes=30,
                description="Very high probability of late delivery - immediate action required",
            ))

        # Credit hold alert
        self._thresholds.append(AlertThreshold(
            alert_type=AlertType.CREDIT_HOLD_RISK,
            prediction_type=PredictionType.CREDIT_HOLD,
            threshold_value=self._config.credit_hold_threshold,
            severity=AlertSeverity.MEDIUM,
            comparison="gte",
            cooldown_minutes=self._config.default_cooldown_minutes,
            description="Credit hold likely - proactive credit review recommended",
        ))

        # Critical credit hold
        if self._config.enable_critical_alerts:
            self._thresholds.append(AlertThreshold(
                alert_type=AlertType.CREDIT_HOLD_RISK,
                prediction_type=PredictionType.CREDIT_HOLD,
                threshold_value=0.85,
                severity=AlertSeverity.HIGH,
                comparison="gte",
                cooldown_minutes=30,
                description="High probability of credit hold - expedite credit review",
            ))

    def add_threshold(self, threshold: AlertThreshold) -> None:
        """
        Add a custom alert threshold.

        Args:
            threshold: The threshold to add
        """
        self._thresholds.append(threshold)
        logger.debug(
            f"Added threshold: {threshold.alert_type.value} "
            f"at {threshold.threshold_value}"
        )

    def remove_threshold(
        self,
        alert_type: AlertType,
        prediction_type: PredictionType
    ) -> bool:
        """
        Remove thresholds matching the specified types.

        Args:
            alert_type: Alert type to remove
            prediction_type: Prediction type to remove

        Returns:
            True if any thresholds were removed
        """
        original_count = len(self._thresholds)
        self._thresholds = [
            t for t in self._thresholds
            if not (t.alert_type == alert_type and
                    t.prediction_type == prediction_type)
        ]
        return len(self._thresholds) < original_count

    def add_handler(self, handler: AlertHandler) -> None:
        """
        Add an alert handler.

        Args:
            handler: The handler to add
        """
        self._handlers.append(handler)
        logger.debug(f"Added alert handler: {type(handler).__name__}")

    def remove_handler(self, handler: AlertHandler) -> bool:
        """
        Remove an alert handler.

        Args:
            handler: The handler to remove

        Returns:
            True if the handler was removed
        """
        try:
            self._handlers.remove(handler)
            return True
        except ValueError:
            return False

    def check_prediction(self, prediction: Prediction) -> List[Alert]:
        """
        Check a prediction against all thresholds and generate alerts.

        Args:
            prediction: The prediction to check

        Returns:
            List of generated alerts
        """
        alerts = []

        # Get the value to check (probability for classification, value for regression)
        if prediction.probability is not None:
            check_value = prediction.probability
        else:
            check_value = float(prediction.predicted_value)

        # Check each threshold
        for threshold in self._thresholds:
            if threshold.prediction_type != prediction.prediction_type:
                continue

            if not threshold.check(check_value):
                continue

            # Check cooldown
            if self._is_in_cooldown(prediction.case_id, threshold):
                logger.debug(
                    f"Alert in cooldown for case {prediction.case_id}: "
                    f"{threshold.alert_type.value}"
                )
                continue

            # Check max alerts per case
            if self._exceeds_max_alerts(prediction.case_id):
                logger.debug(
                    f"Max alerts exceeded for case {prediction.case_id}"
                )
                continue

            # Generate alert
            alert = self._create_alert(prediction, threshold)
            alerts.append(alert)

            # Track alert
            self._track_alert(alert)

            # Notify handlers
            self._notify_handlers(alert)

        return alerts

    def check_predictions(
        self,
        predictions: List[Prediction]
    ) -> List[Alert]:
        """
        Check multiple predictions and generate alerts.

        Args:
            predictions: List of predictions to check

        Returns:
            List of all generated alerts
        """
        all_alerts = []
        for prediction in predictions:
            alerts = self.check_prediction(prediction)
            all_alerts.extend(alerts)
        return all_alerts

    def _create_alert(
        self,
        prediction: Prediction,
        threshold: AlertThreshold
    ) -> Alert:
        """Create an alert from a prediction and threshold."""
        self._alert_counter += 1
        alert_id = f"ALERT-{self._alert_counter:06d}"

        # Build message
        if prediction.probability is not None:
            value_str = f"{prediction.probability:.1%} probability"
        else:
            value_str = f"value {prediction.predicted_value}"

        message = (
            f"{threshold.description}. "
            f"Predicted {value_str} (threshold: {threshold.threshold_value})"
        )

        return Alert(
            alert_id=alert_id,
            case_id=prediction.case_id,
            alert_type=threshold.alert_type,
            severity=threshold.severity,
            prediction=prediction,
            threshold=threshold,
            message=message,
            metadata={
                "features_used": prediction.features_used,
            }
        )

    def _is_in_cooldown(
        self,
        case_id: str,
        threshold: AlertThreshold
    ) -> bool:
        """Check if an alert is in cooldown period."""
        if not self._config.enable_cooldown:
            return False

        case_cooldowns = self._cooldown_tracker.get(case_id, {})
        last_alert_time = case_cooldowns.get(threshold.alert_type.value)

        if last_alert_time is None:
            return False

        cooldown_delta = timedelta(minutes=threshold.cooldown_minutes)
        return datetime.now() - last_alert_time < cooldown_delta

    def _exceeds_max_alerts(self, case_id: str) -> bool:
        """Check if case has exceeded maximum alerts."""
        case_alerts = self._alert_history.get(case_id, [])
        return len(case_alerts) >= self._config.max_alerts_per_case

    def _track_alert(self, alert: Alert) -> None:
        """Track an alert in history and cooldown tracker."""
        # Add to history
        if alert.case_id not in self._alert_history:
            self._alert_history[alert.case_id] = []
        self._alert_history[alert.case_id].append(alert)

        # Update cooldown tracker
        if alert.case_id not in self._cooldown_tracker:
            self._cooldown_tracker[alert.case_id] = {}
        self._cooldown_tracker[alert.case_id][alert.alert_type.value] = alert.timestamp

    def _notify_handlers(self, alert: Alert) -> None:
        """Notify all handlers of an alert."""
        for handler in self._handlers:
            try:
                handler.handle(alert)
            except Exception as e:
                logger.error(f"Handler {type(handler).__name__} failed: {e}")

    def get_alerts_for_case(self, case_id: str) -> List[Alert]:
        """
        Get all alerts for a specific case.

        Args:
            case_id: The case identifier

        Returns:
            List of alerts for the case
        """
        return self._alert_history.get(case_id, []).copy()

    def get_active_alerts(
        self,
        severity_filter: Optional[AlertSeverity] = None
    ) -> List[Alert]:
        """
        Get all unacknowledged alerts.

        Args:
            severity_filter: Optional filter for minimum severity

        Returns:
            List of active alerts
        """
        active = []
        for case_alerts in self._alert_history.values():
            for alert in case_alerts:
                if not alert.acknowledged:
                    if severity_filter is None or alert.severity <= severity_filter:
                        active.append(alert)

        # Sort by severity and timestamp
        active.sort(key=lambda a: (a.severity, a.timestamp))
        return active

    def acknowledge_alert(
        self,
        alert_id: str,
        user: str = "system"
    ) -> bool:
        """
        Acknowledge an alert.

        Args:
            alert_id: The alert ID to acknowledge
            user: User or system acknowledging the alert

        Returns:
            True if alert was found and acknowledged
        """
        for case_alerts in self._alert_history.values():
            for alert in case_alerts:
                if alert.alert_id == alert_id:
                    alert.acknowledge(user)
                    return True
        return False

    def get_alert_summary(self) -> Dict[str, Any]:
        """
        Get summary statistics for all alerts.

        Returns:
            Dictionary with alert statistics
        """
        total = 0
        by_severity: Dict[str, int] = {}
        by_type: Dict[str, int] = {}
        acknowledged = 0

        for case_alerts in self._alert_history.values():
            for alert in case_alerts:
                total += 1
                sev_key = alert.severity.value
                by_severity[sev_key] = by_severity.get(sev_key, 0) + 1
                type_key = alert.alert_type.value
                by_type[type_key] = by_type.get(type_key, 0) + 1
                if alert.acknowledged:
                    acknowledged += 1

        return {
            "total_alerts": total,
            "active_alerts": total - acknowledged,
            "acknowledged_alerts": acknowledged,
            "by_severity": by_severity,
            "by_type": by_type,
            "cases_with_alerts": len(self._alert_history),
        }

    def clear_history(self, case_id: Optional[str] = None) -> None:
        """
        Clear alert history.

        Args:
            case_id: Optional case ID to clear (clears all if not specified)
        """
        if case_id:
            self._alert_history.pop(case_id, None)
            self._cooldown_tracker.pop(case_id, None)
        else:
            self._alert_history.clear()
            self._cooldown_tracker.clear()


class RiskScorer:
    """
    Calculates composite risk scores from multiple predictions.

    IMPORTANT: This class is designed to PREVENT mixing of incompatible value types.
    Only predictions with ValueType.PROBABILITY can be meaningfully averaged together.
    Raw values (like completion time in hours) require explicit SLA context to convert
    to a risk ratio.

    The old approach of dividing hours by 168 to create a "fake probability" has been
    removed as it's mathematically invalid.
    """

    def __init__(
        self,
        weights: Optional[Dict[PredictionType, float]] = None,
        sla_hours: Optional[float] = None,
        strict_mode: bool = True,
    ):
        """
        Initialize the risk scorer.

        Args:
            weights: Weights for each prediction type (default: equal weights)
            sla_hours: Expected SLA in hours for completion time. Required if
                       COMPLETION_TIME predictions are to be included.
            strict_mode: If True, raises error on value type mixing. If False,
                         logs warning and excludes incompatible predictions.
        """
        self._weights = weights or {
            PredictionType.LATE_DELIVERY: 0.5,
            PredictionType.CREDIT_HOLD: 0.3,
            PredictionType.COMPLETION_TIME: 0.2,
        }
        self._sla_hours = sla_hours
        self._strict_mode = strict_mode

    def calculate_risk_score(
        self,
        predictions: List[Prediction],
        normalize: bool = True
    ) -> float:
        """
        Calculate a composite risk score from predictions.

        IMPORTANT: Only predictions with ValueType.PROBABILITY are included by default.
        To include completion time predictions, you MUST provide sla_hours in __init__.

        Args:
            predictions: List of predictions
            normalize: Whether to normalize to 0-1 range

        Returns:
            Composite risk score (only from probability-based predictions)
        """
        if not predictions:
            return 0.0

        total_weight = 0.0
        weighted_sum = 0.0
        excluded_count = 0
        included_types = []

        for prediction in predictions:
            weight = self._weights.get(prediction.prediction_type, 0.1)
            risk_value: Optional[float] = None

            # CRITICAL: Only use values that are true probabilities or properly converted
            if prediction.value_type == ValueType.PROBABILITY:
                # True probability from classifier - safe to use
                if prediction.probability is not None:
                    risk_value = prediction.probability
                    included_types.append(f"{prediction.prediction_type.value}:PROB")

            elif prediction.value_type == ValueType.RAW:
                # Raw value - needs conversion with domain context
                if prediction.prediction_type == PredictionType.COMPLETION_TIME:
                    if self._sla_hours is not None:
                        # Convert to SLA ratio - this is a RATIO, not a probability
                        # but at least it's semantically meaningful
                        sla_ratio = float(prediction.predicted_value) / self._sla_hours
                        risk_value = min(1.0, sla_ratio)
                        included_types.append(f"{prediction.prediction_type.value}:RATIO")
                    else:
                        excluded_count += 1
                        if self._strict_mode:
                            warnings.warn(
                                f"COMPLETION_TIME prediction excluded: sla_hours not "
                                f"provided. Cannot convert {prediction.predicted_value} "
                                f"hours to risk score without SLA context. "
                                f"Initialize RiskScorer with sla_hours parameter.",
                                UserWarning,
                                stacklevel=2
                            )
                else:
                    # Other RAW types - cannot convert
                    excluded_count += 1
                    if self._strict_mode:
                        warnings.warn(
                            f"Prediction of type {prediction.prediction_type.value} "
                            f"has ValueType.RAW and cannot be included in risk score "
                            f"without conversion context.",
                            UserWarning,
                            stacklevel=2
                        )

            elif prediction.value_type == ValueType.RATIO:
                # Already a ratio (0-1) - can include but note it's not a probability
                risk_value = float(prediction.predicted_value)
                included_types.append(f"{prediction.prediction_type.value}:RATIO")

            elif prediction.value_type == ValueType.HEURISTIC:
                # Heuristic scores should generally not be mixed with probabilities
                excluded_count += 1
                if self._strict_mode:
                    warnings.warn(
                        f"Prediction of type {prediction.prediction_type.value} "
                        f"has ValueType.HEURISTIC and was excluded from risk score. "
                        f"Heuristic scores should not be mixed with probabilities.",
                        UserWarning,
                        stacklevel=2
                    )

            if risk_value is not None:
                weighted_sum += weight * risk_value
                total_weight += weight

        if excluded_count > 0:
            logger.debug(
                f"RiskScorer excluded {excluded_count} predictions due to value type. "
                f"Included: {included_types}"
            )

        if total_weight == 0:
            if self._strict_mode and predictions:
                warnings.warn(
                    "RiskScorer returned 0.0 because no predictions had compatible "
                    "ValueType. Ensure predictions have ValueType.PROBABILITY or "
                    "provide sla_hours for COMPLETION_TIME predictions.",
                    UserWarning,
                    stacklevel=2
                )
            return 0.0

        score = weighted_sum / total_weight

        if normalize:
            score = max(0.0, min(1.0, score))

        return score

    def calculate_probability_only_risk(
        self,
        predictions: List[Prediction],
    ) -> float:
        """
        Calculate risk score ONLY from true probability predictions.

        This method explicitly excludes any non-probability values, ensuring
        the result is a valid weighted average of probabilities.

        Args:
            predictions: List of predictions

        Returns:
            Risk score from probability-based predictions only
        """
        prob_predictions = [
            p for p in predictions
            if p.value_type == ValueType.PROBABILITY and p.probability is not None
        ]

        if not prob_predictions:
            return 0.0

        total_weight = 0.0
        weighted_sum = 0.0

        for prediction in prob_predictions:
            weight = self._weights.get(prediction.prediction_type, 0.1)
            weighted_sum += weight * prediction.probability
            total_weight += weight

        return weighted_sum / total_weight if total_weight > 0 else 0.0

    def get_risk_level(self, risk_score: float) -> str:
        """
        Convert a risk score to a risk level.

        Args:
            risk_score: Numeric risk score (0-1)

        Returns:
            Risk level string
        """
        if risk_score >= 0.8:
            return "critical"
        elif risk_score >= 0.6:
            return "high"
        elif risk_score >= 0.4:
            return "medium"
        elif risk_score >= 0.2:
            return "low"
        else:
            return "minimal"

    def get_detailed_breakdown(
        self,
        predictions: List[Prediction],
    ) -> Dict[str, Any]:
        """
        Get detailed breakdown of risk components.

        Returns information about which predictions were included/excluded
        and why, making the risk calculation transparent.
        """
        breakdown = {
            "included": [],
            "excluded": [],
            "warnings": [],
        }

        for prediction in predictions:
            info = {
                "type": prediction.prediction_type.value,
                "value_type": prediction.value_type.value,
                "predicted_value": prediction.predicted_value,
                "probability": prediction.probability,
            }

            if prediction.value_type == ValueType.PROBABILITY:
                info["risk_contribution"] = prediction.probability
                info["reason"] = "True probability from classifier"
                breakdown["included"].append(info)
            elif prediction.value_type == ValueType.RAW:
                if prediction.prediction_type == PredictionType.COMPLETION_TIME:
                    if self._sla_hours:
                        info["risk_contribution"] = min(
                            1.0,
                            float(prediction.predicted_value) / self._sla_hours
                        )
                        info["reason"] = f"Converted to SLA ratio (SLA={self._sla_hours}h)"
                        breakdown["included"].append(info)
                    else:
                        info["reason"] = "Excluded: no SLA provided for conversion"
                        breakdown["excluded"].append(info)
                        breakdown["warnings"].append(
                            f"COMPLETION_TIME prediction ({prediction.predicted_value}h) "
                            f"excluded - provide sla_hours to include"
                        )
                else:
                    info["reason"] = "Excluded: RAW value with no conversion context"
                    breakdown["excluded"].append(info)
            elif prediction.value_type == ValueType.HEURISTIC:
                info["reason"] = "Excluded: heuristic scores not mixed with probabilities"
                breakdown["excluded"].append(info)
            else:
                info["reason"] = f"Included as {prediction.value_type.value}"
                info["risk_contribution"] = float(prediction.predicted_value)
                breakdown["included"].append(info)

        return breakdown


def create_alert_manager(
    late_threshold: float = 0.7,
    credit_threshold: float = 0.6
) -> AlertManager:
    """
    Create an AlertManager with common configuration.

    Args:
        late_threshold: Threshold for late delivery alerts
        credit_threshold: Threshold for credit hold alerts

    Returns:
        Configured AlertManager
    """
    config = AlertConfig(
        late_delivery_threshold=late_threshold,
        credit_hold_threshold=credit_threshold,
    )
    manager = AlertManager(config)
    manager.add_handler(LoggingAlertHandler())
    return manager
