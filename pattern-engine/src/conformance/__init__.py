"""
Conformance Checking Module for Transaction Forensics.

This module provides conformance checking capabilities for comparing
actual SAP event logs against expected process models. It implements
established process mining techniques for detecting deviations and
measuring fitness.

Key Components:
- ProcessModel: State machine representation of expected process flows
- ConformanceChecker: Engine for comparing logs against models
- DeviationDetector: Identifies deviations from expected behavior
- SeverityScorer: Classifies deviation severity

Main Features:
- Define expected SAP process flows as state machines
- Compare event logs against expected models
- Detect and classify deviations:
  - Skipped activities (e.g., delivery without order)
  - Wrong order (e.g., invoice before delivery)
  - Unexpected activities
  - Missing activities
- Score deviations by severity (critical/major/minor)
- Calculate conformance rate as percentage

Example Usage:
    from conformance import ConformanceChecker, get_o2c_model

    # Get pre-built Order-to-Cash model
    model = get_o2c_model()

    # Create checker
    checker = ConformanceChecker(model)

    # Check a single trace
    trace = [
        {"activity": "OrderCreated", "timestamp": "2024-01-01T10:00:00"},
        {"activity": "DeliveryCreated", "timestamp": "2024-01-02T10:00:00"},
        {"activity": "GoodsIssued", "timestamp": "2024-01-03T10:00:00"},
        {"activity": "InvoiceCreated", "timestamp": "2024-01-04T10:00:00"},
    ]
    result = checker.check_trace(trace, case_id="ORDER001")

    print(f"Conformance: {result.conformance_percentage}%")
    print(f"Deviations: {len(result.deviations)}")

    # Check an event log with multiple cases
    event_log = [
        {"case_id": "001", "events": [...]},
        {"case_id": "002", "events": [...]},
    ]
    results = checker.check_log(event_log)

    print(f"Conformance Rate: {results.conformance_rate}%")
    print(f"Conformant Cases: {results.conformant_cases}/{results.total_cases}")

Academic References:
- van der Aalst, W.M.P. (2016). Process Mining: Data Science in Action.
- Adriansyah, A., van Dongen, B.F., & van der Aalst, W.M.P. (2011).
  Conformance checking using cost-based fitness analysis.
- Rozinat, A., & van der Aalst, W.M.P. (2008). Conformance checking of
  processes based on monitoring real behavior.
"""

from .models import (
    Activity,
    ActivityType,
    ProcessModel,
    ProcessModelBuilder,
    ProcessState,
    Transition,
)

from .deviations import (
    Deviation,
    DeviationDetector,
    DeviationSummary,
    DeviationType,
    Severity,
    SeverityScorer,
    DEFAULT_SEVERITY_RULES,
)

from .checker import (
    CaseConformanceResult,
    ConformanceChecker,
    ConformanceResult,
    calculate_conformance_rate,
    check_conformance,
)

from .templates import (
    get_o2c_model,
    get_simple_o2c_model,
    get_detailed_o2c_model,
    SAP_O2C_ACTIVITIES,
)

__all__ = [
    # Models
    "Activity",
    "ActivityType",
    "ProcessModel",
    "ProcessModelBuilder",
    "ProcessState",
    "Transition",
    # Deviations
    "Deviation",
    "DeviationDetector",
    "DeviationSummary",
    "DeviationType",
    "Severity",
    "SeverityScorer",
    "DEFAULT_SEVERITY_RULES",
    # Checker
    "CaseConformanceResult",
    "ConformanceChecker",
    "ConformanceResult",
    "calculate_conformance_rate",
    "check_conformance",
    # Templates
    "get_o2c_model",
    "get_simple_o2c_model",
    "get_detailed_o2c_model",
    "SAP_O2C_ACTIVITIES",
]

__version__ = "1.0.0"
