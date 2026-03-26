"""
PII Redaction Module for Transaction Forensics.

Provides configurable redaction of sensitive information including:
- Email addresses
- Phone numbers
- Person names (basic patterns)
- Physical addresses
- PO numbers
- SAP document numbers (configurable)

Two modes:
- "raw_local": Minimal redaction, for internal use only
- "shareable": Full/aggressive redaction (default), safe for sharing

All redactions are DETERMINISTIC: same input = same output (given same salt).
"""

import hashlib
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Pattern, Tuple, Match


class RedactionMode(Enum):
    """Redaction mode enumeration."""
    RAW_LOCAL = "raw_local"      # Minimal redaction
    SHAREABLE = "shareable"      # Full/aggressive redaction (default)


@dataclass
class RedactionConfig:
    """Configuration for redaction behavior."""
    mode: RedactionMode = RedactionMode.SHAREABLE
    hash_sap_doc_numbers: bool = True  # If False, keep SAP doc numbers as-is
    hash_po_numbers: bool = True  # Hash PO numbers
    hash_salt: str = "sap_workflow_mining"  # Salt for hashing (determinism)
    preserve_format: bool = True  # Preserve some format hints in replacements


@dataclass
class RedactionStats:
    """Statistics about redactions performed."""
    emails_redacted: int = 0
    phones_redacted: int = 0
    names_redacted: int = 0
    addresses_redacted: int = 0
    po_numbers_redacted: int = 0
    sap_docs_hashed: int = 0
    total_redactions: int = 0


class Redactor:
    """
    PII and sensitive data redactor.

    Detects and masks sensitive information in text based on configurable
    patterns and rules. All redactions are deterministic given the same salt.
    """

    # Email pattern - comprehensive email matching
    EMAIL_PATTERN = re.compile(
        r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b',
        re.IGNORECASE
    )

    # Phone patterns - various formats
    # NOTE: These patterns are designed to NOT match SAP document numbers (plain 10-digit sequences)
    # Phone numbers require separators (dashes, dots, spaces, or parentheses) to be detected
    PHONE_PATTERNS = [
        # International format: +1-234-567-8900, +44 20 7123 4567
        re.compile(r'\+\d{1,3}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9}'),
        # US format with parentheses: (123) 456-7890
        re.compile(r'\(\d{3}\)[-.\s]?\d{3}[-.\s]?\d{4}'),
        # US format with separators REQUIRED: 123-456-7890, 123.456.7890, 123 456 7890
        re.compile(r'\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b'),
        # European format: 0123 456789 (starting with 0, with space separator)
        re.compile(r'\b0\d{2,4}\s\d{3,8}\b'),
        # German format: +49 (0) 123 456789
        re.compile(r'\+49\s*\(0\)\s*\d{2,4}[-.\s]?\d{3,8}'),
    ]

    # Name patterns - common name-like patterns
    NAME_PATTERNS = [
        # Salutation + Name: Mr. John Smith, Mrs. Jane Doe
        re.compile(r'\b(?:Mr\.?|Mrs\.?|Ms\.?|Dr\.?|Prof\.?)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b'),
        # Contact/Attn patterns: Contact: John Smith, Attn: Jane Doe
        re.compile(r'\b(?:Contact|Attn|Attention|Name|Signed|Approved by|Requested by|Created by):\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b', re.IGNORECASE),
        # Common name field patterns from SAP
        re.compile(r'\b(?:ERNAM|ERDAT|AENAM|AEDAT):\s*[A-Z][A-Z0-9]+\b'),
    ]

    # Address patterns
    ADDRESS_PATTERNS = [
        # US address: 123 Main St, City, ST 12345
        re.compile(
            r'\b\d{1,5}\s+[A-Za-z0-9\s]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Way|Place|Pl)\.?\s*,?\s*[A-Za-z\s]+,?\s*[A-Z]{2}\s*\d{5}(?:-\d{4})?\b',
            re.IGNORECASE
        ),
        # German address: Hauptstrasse 123, 12345 Berlin
        re.compile(
            r'\b[A-Za-z\u00C0-\u017F]+(?:strasse|stra\u00DFe|str\.?|weg|platz|gasse)\s*\d{1,5}[a-z]?\s*,?\s*\d{5}\s+[A-Za-z\u00C0-\u017F]+\b',
            re.IGNORECASE
        ),
        # PO Box patterns
        re.compile(r'\b(?:P\.?O\.?\s*Box|Postfach)\s*\d+\b', re.IGNORECASE),
        # ZIP/Postal codes alone
        re.compile(r'\b\d{5}(?:-\d{4})?\b'),  # US ZIP
        re.compile(r'\b[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}\b'),  # UK postcode
    ]

    # PO Number patterns - various formats
    PO_NUMBER_PATTERNS = [
        # PO-XXXX-123456 format (as in synthetic data)
        re.compile(r'\bPO[-_]?[A-Za-z0-9]{2,6}[-_]?\d{4,8}\b', re.IGNORECASE),
        # Standard PO# formats
        re.compile(r'\bPO\s*#?\s*\d{4,10}\b', re.IGNORECASE),
        # Purchase Order Number patterns
        re.compile(r'\b(?:Purchase\s*Order|PO\s*Number|PO\s*No\.?)[\s:]*[A-Za-z0-9-]{5,15}\b', re.IGNORECASE),
        # Generic PO with prefix
        re.compile(r'\bPO[A-Z]?\d{6,10}\b'),
    ]

    # SAP document number patterns
    SAP_DOC_PATTERNS = [
        # Standard SAP document numbers (10 digits)
        re.compile(r'\b\d{10}\b'),
        # SAP document with prefix
        re.compile(r'\b(?:SO|DO|DL|IV|PO|PR|SA)\d{8,10}\b'),
    ]

    def __init__(
        self,
        mode: str = "shareable",
        hash_sap_doc_numbers: bool = True,
        hash_po_numbers: bool = True,
        hash_salt: str = "sap_workflow_mining"
    ):
        """
        Initialize the redactor.

        Args:
            mode: Redaction mode - "raw_local" or "shareable"
            hash_sap_doc_numbers: Whether to hash SAP document numbers
            hash_po_numbers: Whether to hash PO numbers
            hash_salt: Salt for deterministic hashing
        """
        self.config = RedactionConfig(
            mode=RedactionMode(mode),
            hash_sap_doc_numbers=hash_sap_doc_numbers,
            hash_po_numbers=hash_po_numbers,
            hash_salt=hash_salt
        )
        self.stats = RedactionStats()
        # Cache for deterministic replacements
        # EDGE CASE FIX: Use bounded cache with LRU-like eviction
        self._hash_cache: Dict[str, str] = {}
        self._hash_cache_max_size: int = 100000  # Limit to 100K entries
        self._hash_cache_order: List[str] = []  # Track insertion order for eviction

    def redact_text(self, text: str) -> str:
        """
        Redact sensitive information from text.

        Args:
            text: Input text to redact

        Returns:
            Redacted text with sensitive info replaced
        """
        if not text or self.config.mode == RedactionMode.RAW_LOCAL:
            return text

        result = text

        # EDGE CASE FIX: First, identify and mark potential SAP document numbers
        # before phone pattern matching can claim them incorrectly.
        # We do this by temporarily replacing SAP doc numbers with placeholders,
        # then running other redactions, then restoring SAP doc handling.
        sap_doc_placeholders = {}
        if self.config.hash_sap_doc_numbers:
            result, sap_doc_placeholders = self._protect_sap_doc_numbers(result)

        # Apply redactions in order of specificity (most specific first)
        result = self._redact_emails(result)
        result = self._redact_phones(result)
        result = self._redact_names(result)
        result = self._redact_addresses(result)
        result = self._redact_po_numbers(result)

        # Restore and hash SAP document numbers
        if self.config.hash_sap_doc_numbers:
            result = self._restore_and_hash_sap_docs(result, sap_doc_placeholders)

        return result

    def _protect_sap_doc_numbers(self, text: str) -> Tuple[str, Dict[str, str]]:
        """
        Temporarily protect SAP document numbers from being matched as phone numbers.

        EDGE CASE FIX: Phone patterns like 123-456-7890 overlap with SAP doc numbers
        like 1234567890. We protect SAP docs first, then run phone redaction.
        """
        placeholders = {}
        result = text

        # Protect 10-digit numbers (standard SAP docs)
        def protect_10digit(match):
            doc_num = match.group(0)
            placeholder = f"__SAP_DOC_{len(placeholders)}__"
            placeholders[placeholder] = doc_num
            return placeholder

        result = re.sub(r'\b\d{10}\b', protect_10digit, result)

        # Protect prefixed SAP doc numbers
        def protect_prefixed(match):
            full_match = match.group(0)
            placeholder = f"__SAP_DOC_{len(placeholders)}__"
            placeholders[placeholder] = full_match
            return placeholder

        result = re.sub(r'\b(?:SO|DO|DL|IV|PO|PR|SA)\d{8,10}\b', protect_prefixed, result)

        return result, placeholders

    def _restore_and_hash_sap_docs(self, text: str, placeholders: Dict[str, str]) -> str:
        """Restore SAP doc number placeholders and hash them."""
        result = text

        for placeholder, original in placeholders.items():
            # Hash the original value
            if re.match(r'\d{10}$', original):
                # Plain 10-digit number
                hashed = self._create_hash(original, prefix="DOC")
                self.stats.sap_docs_hashed += 1
                self.stats.total_redactions += 1
            elif re.match(r'^(SO|DO|DL|IV|PO|PR|SA)\d{8,10}$', original):
                # Prefixed doc number
                prefix = re.match(r'^(SO|DO|DL|IV|PO|PR|SA)', original).group(1)
                doc_num = original[len(prefix):]
                hashed = f"{prefix}{self._create_hash(doc_num, prefix='DOC')}"
                self.stats.sap_docs_hashed += 1
                self.stats.total_redactions += 1
            else:
                hashed = self._create_hash(original, prefix="DOC")
                self.stats.sap_docs_hashed += 1
                self.stats.total_redactions += 1

            result = result.replace(placeholder, hashed)

        return result

    def redact_document(self, doc: Dict[str, Any]) -> Dict[str, Any]:
        """
        Redact sensitive information from a document dictionary.

        Args:
            doc: Document dictionary to redact

        Returns:
            New document with redacted values
        """
        if self.config.mode == RedactionMode.RAW_LOCAL:
            return doc.copy()

        return self._redact_dict(doc)

    def _redact_dict(self, d: Dict[str, Any]) -> Dict[str, Any]:
        """Recursively redact a dictionary."""
        result = {}
        for key, value in d.items():
            if isinstance(value, str):
                result[key] = self.redact_text(value)
            elif isinstance(value, dict):
                result[key] = self._redact_dict(value)
            elif isinstance(value, list):
                result[key] = self._redact_list(value)
            else:
                result[key] = value
        return result

    def _redact_list(self, lst: List[Any]) -> List[Any]:
        """Recursively redact a list."""
        result = []
        for item in lst:
            if isinstance(item, str):
                result.append(self.redact_text(item))
            elif isinstance(item, dict):
                result.append(self._redact_dict(item))
            elif isinstance(item, list):
                result.append(self._redact_list(item))
            else:
                result.append(item)
        return result

    def _redact_emails(self, text: str) -> str:
        """Redact email addresses."""
        def replace_email(match):
            self.stats.emails_redacted += 1
            self.stats.total_redactions += 1
            return "[EMAIL]"

        return self.EMAIL_PATTERN.sub(replace_email, text)

    def _redact_phones(self, text: str) -> str:
        """Redact phone numbers."""
        result = text
        for pattern in self.PHONE_PATTERNS:
            def replace_phone(match):
                self.stats.phones_redacted += 1
                self.stats.total_redactions += 1
                return "[PHONE]"
            result = pattern.sub(replace_phone, result)
        return result

    def _redact_names(self, text: str) -> str:
        """Redact person names based on patterns."""
        result = text
        for pattern in self.NAME_PATTERNS:
            def replace_name(match):
                self.stats.names_redacted += 1
                self.stats.total_redactions += 1
                # Preserve the prefix if it's informative
                matched = match.group(0)
                if ':' in matched:
                    # EDGE CASE FIX: Validate split result has non-empty prefix
                    parts = matched.split(':', 1)  # Split only on first colon
                    prefix = parts[0].strip()
                    if prefix:  # Only preserve if prefix is non-empty
                        return f"{prefix}: [NAME]"
                return "[NAME]"
            result = pattern.sub(replace_name, result)
        return result

    def _redact_addresses(self, text: str) -> str:
        """Redact physical addresses."""
        result = text
        for pattern in self.ADDRESS_PATTERNS:
            def replace_address(match):
                self.stats.addresses_redacted += 1
                self.stats.total_redactions += 1
                return "[ADDRESS]"
            result = pattern.sub(replace_address, result)
        return result

    def _redact_po_numbers(self, text: str) -> str:
        """Redact or hash PO numbers."""
        result = text

        for pattern in self.PO_NUMBER_PATTERNS:
            def replace_po(match):
                po_num = match.group(0)
                self.stats.po_numbers_redacted += 1
                self.stats.total_redactions += 1

                if self.config.hash_po_numbers:
                    return self._create_hash(po_num, prefix="PO_NUMBER")
                else:
                    return "[PO_NUMBER]"

            result = pattern.sub(replace_po, result)

        return result

    def _hash_sap_doc_numbers(self, text: str) -> str:
        """Hash SAP document numbers for anonymization while preserving referential integrity.

        NOTE: This method is now only called when SAP doc protection is disabled.
        When protection is enabled, _protect_sap_doc_numbers and _restore_and_hash_sap_docs
        are used instead to prevent phone/doc number conflicts.
        """
        result = text

        # Only hash long numeric sequences that look like SAP doc numbers
        def hash_doc_number(match: Match) -> str:
            doc_num = match.group(0)
            # Only hash if it looks like a real doc number (8+ digits)
            if len(doc_num) >= 8:
                self.stats.sap_docs_hashed += 1
                self.stats.total_redactions += 1
                return self._create_hash(doc_num, prefix="DOC")
            return doc_num

        # Hash 10-digit numbers (standard SAP)
        result = re.sub(r'\b\d{10}\b', hash_doc_number, result)

        # Hash prefixed doc numbers
        def hash_prefixed(match: Match) -> str:
            prefix = match.group(1)
            doc_num = match.group(2)
            self.stats.sap_docs_hashed += 1
            self.stats.total_redactions += 1
            return f"{prefix}{self._create_hash(doc_num, prefix='DOC')}"

        result = re.sub(r'\b(SO|DO|DL|IV|PO|PR|SA)(\d{8,10})\b', hash_prefixed, result)

        return result

    def _create_hash(self, value: str, prefix: str = "DOC") -> str:
        """
        Create a deterministic hash of a value.

        Same input + same salt = same output (deterministic).

        EDGE CASE FIX: Cache is bounded to prevent memory exhaustion during
        large batch processing. Uses simple FIFO eviction when limit reached.
        """
        # Check cache first for performance
        cache_key = f"{prefix}:{value}"
        if cache_key in self._hash_cache:
            return self._hash_cache[cache_key]

        salted = f"{self.config.hash_salt}:{value}"
        hash_bytes = hashlib.sha256(salted.encode()).hexdigest()[:8]
        result = f"[{prefix}_{hash_bytes.upper()}]"

        # EDGE CASE FIX: Evict oldest entries if cache is full
        if len(self._hash_cache) >= self._hash_cache_max_size:
            # Evict oldest 10% of cache
            evict_count = self._hash_cache_max_size // 10
            keys_to_evict = self._hash_cache_order[:evict_count]
            for key in keys_to_evict:
                self._hash_cache.pop(key, None)
            self._hash_cache_order = self._hash_cache_order[evict_count:]

        # Cache the result
        self._hash_cache[cache_key] = result
        self._hash_cache_order.append(cache_key)
        return result

    def get_stats(self) -> Dict[str, int]:
        """Get redaction statistics."""
        return {
            'emails_redacted': self.stats.emails_redacted,
            'phones_redacted': self.stats.phones_redacted,
            'names_redacted': self.stats.names_redacted,
            'addresses_redacted': self.stats.addresses_redacted,
            'po_numbers_redacted': self.stats.po_numbers_redacted,
            'sap_docs_hashed': self.stats.sap_docs_hashed,
            'total_redactions': self.stats.total_redactions,
        }

    def reset_stats(self):
        """Reset redaction statistics."""
        self.stats = RedactionStats()

    @classmethod
    def create_shareable(cls, hash_salt: str = "sap_workflow_mining") -> 'Redactor':
        """Create a redactor configured for shareable output (aggressive redaction)."""
        return cls(mode="shareable", hash_sap_doc_numbers=True, hash_po_numbers=True, hash_salt=hash_salt)

    @classmethod
    def create_raw_local(cls) -> 'Redactor':
        """Create a redactor that performs minimal redaction (raw local mode)."""
        return cls(mode="raw_local", hash_sap_doc_numbers=False, hash_po_numbers=False)


def redact_email(text: str) -> str:
    """Convenience function to redact emails from text."""
    return Redactor.EMAIL_PATTERN.sub("[EMAIL]", text)


def redact_phone(text: str) -> str:
    """Convenience function to redact phone numbers from text."""
    result = text
    for pattern in Redactor.PHONE_PATTERNS:
        result = pattern.sub("[PHONE]", result)
    return result


def hash_document_number(doc_num: str, salt: str = "sap_workflow_mining") -> str:
    """Hash a document number deterministically."""
    salted = f"{salt}:{doc_num}"
    hash_bytes = hashlib.sha256(salted.encode()).hexdigest()[:8]
    return f"[DOC_{hash_bytes.upper()}]"


def redact_all(
    data: List[Dict[str, Any]],
    mode: str = "shareable",
    hash_salt: str = "sap_workflow_mining"
) -> List[Dict[str, Any]]:
    """
    Convenience function to redact all documents in a list.

    Args:
        data: List of document dictionaries
        mode: Redaction mode ("raw_local" or "shareable")
        hash_salt: Salt for deterministic hashing

    Returns:
        List of redacted documents
    """
    redactor = Redactor(mode=mode, hash_salt=hash_salt)
    return [redactor.redact_document(doc) for doc in data]
