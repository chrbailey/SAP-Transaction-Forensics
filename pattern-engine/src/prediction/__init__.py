"""
Predictive Monitoring Module for SAP Workflow Mining.

This module provides predictive process monitoring capabilities for SAP
Order-to-Cash (O2C) workflows. It uses machine learning to predict process
outcomes and generate alerts for at-risk cases.

Key Components:
- FeatureExtractor: Extracts ML features from process events
- ClassificationModel: Predicts binary outcomes (late, credit hold)
- RegressionModel: Predicts continuous values (completion time)
- AlertManager: Generates alerts based on predictions

Main Features:
- Extract features from SAP O2C events (cycle times, document counts, patterns)
- Train classifiers to predict:
  - Will this order be late? (binary classification)
  - Will this order require credit hold? (binary classification)
  - Estimated completion time (regression)
- Alert on high-risk cases with configurable thresholds
- Support both online prediction and batch scoring

Example Usage:
    from prediction import (
        FeatureExtractor,
        ClassificationModel,
        PredictionType,
        AlertManager,
    )

    # Extract features from a trace
    extractor = FeatureExtractor()
    trace = [
        {"activity": "OrderCreated", "timestamp": "2024-01-01T10:00:00"},
        {"activity": "DeliveryCreated", "timestamp": "2024-01-02T14:00:00"},
    ]
    features = extractor.extract(trace, case_id="ORDER001")

    # Train a late delivery model
    model = ClassificationModel(PredictionType.LATE_DELIVERY)
    model.train(X_train, y_train)

    # Make predictions
    prediction = model.predict_from_trace(trace, case_id="ORDER001")
    print(f"Late probability: {prediction.probability:.2%}")

    # Check for alerts
    alert_manager = AlertManager()
    alerts = alert_manager.check_prediction(prediction)
    for alert in alerts:
        print(f"Alert: {alert.message}")

Example - Batch Scoring:
    from prediction import PredictiveMonitor, PredictionType

    # Create monitor with all models
    monitor = PredictiveMonitor()
    monitor.add_classifier(PredictionType.LATE_DELIVERY)
    monitor.add_classifier(PredictionType.CREDIT_HOLD)
    monitor.add_regressor(PredictionType.COMPLETION_TIME)

    # Train models
    monitor.train_model(PredictionType.LATE_DELIVERY, X_train, y_late)
    monitor.train_model(PredictionType.CREDIT_HOLD, X_train, y_credit)
    monitor.train_model(PredictionType.COMPLETION_TIME, X_train, y_time)

    # Batch predict
    results = monitor.batch_predict(cases)
    for case_id, predictions in results.items():
        print(f"Case {case_id}:")
        for pred in predictions:
            print(f"  {pred.prediction_type.value}: {pred.predicted_value}")

References:
- Teinemaa, I., et al. (2019). Outcome-oriented predictive process monitoring.
  ACM Transactions on Intelligent Systems and Technology, 10(2), 1-57.
- Di Francescomarino, C., et al. (2018). Predictive business process monitoring
  framework with hyperparameter optimization. CAiSE 2018.
- Verenich, I., et al. (2019). Survey and cross-benchmark comparison of
  remaining time prediction methods in business process monitoring.
  ACM TIST, 10(4), 1-34.
"""

from .features import (
    ExtractedFeatures,
    FeatureConfig,
    FeatureExtractor,
    FeatureType,
    O2C_ACTIVITIES,
    O2C_MILESTONE_ORDER,
    extract_features,
    extract_features_batch,
)

from .models import (
    ClassificationModel,
    ModelConfig,
    ModelType,
    Prediction,
    PredictionType,
    PredictiveModel,
    PredictiveMonitor,
    RegressionModel,
    TrainingResult,
    ValueType,  # IMPORTANT: Use to distinguish real probabilities from fake ones
    create_completion_time_model,
    create_credit_hold_model,
    create_late_delivery_model,
)

from .alerts import (
    Alert,
    AlertConfig,
    AlertHandler,
    AlertManager,
    AlertSeverity,
    AlertThreshold,
    AlertType,
    CallbackAlertHandler,
    LoggingAlertHandler,
    QueueAlertHandler,
    RiskScorer,
    create_alert_manager,
)

__all__ = [
    # Features
    "ExtractedFeatures",
    "FeatureConfig",
    "FeatureExtractor",
    "FeatureType",
    "O2C_ACTIVITIES",
    "O2C_MILESTONE_ORDER",
    "extract_features",
    "extract_features_batch",
    # Models
    "ClassificationModel",
    "ModelConfig",
    "ModelType",
    "Prediction",
    "PredictionType",
    "PredictiveModel",
    "PredictiveMonitor",
    "RegressionModel",
    "TrainingResult",
    "ValueType",
    "create_completion_time_model",
    "create_credit_hold_model",
    "create_late_delivery_model",
    # Alerts
    "Alert",
    "AlertConfig",
    "AlertHandler",
    "AlertManager",
    "AlertSeverity",
    "AlertThreshold",
    "AlertType",
    "CallbackAlertHandler",
    "LoggingAlertHandler",
    "QueueAlertHandler",
    "RiskScorer",
    "create_alert_manager",
]

__version__ = "1.0.0"
