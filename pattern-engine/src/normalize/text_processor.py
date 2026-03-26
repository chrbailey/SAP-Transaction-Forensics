"""
Text Normalization Module for Transaction Forensics.

Provides text preprocessing including:
- Lowercasing
- SAP boilerplate removal
- Tokenization
- Abbreviation expansion
"""

import re
from typing import Dict, List, Optional, Set


class TextProcessor:
    """
    Text processor for normalizing SAP workflow text data.

    Handles common SAP text patterns, abbreviations, and boilerplate.
    """

    # Common SAP abbreviations and their expansions
    # Note: As per requirements, these specific mappings are required:
    # {"EXPDT": "expedite", "CUST": "customer", "REQ": "request"}
    ABBREVIATIONS: Dict[str, str] = {
        # Required mappings from specification
        'EXPDT': 'expedite',
        'CUST': 'customer',
        'REQ': 'request',

        # Shipping/Logistics
        'EXP': 'expedite',
        'EXPD': 'expedited',
        'EXPR': 'express',
        'STD': 'standard',
        'DEL': 'delivery',
        'DLVR': 'delivery',
        'DLVY': 'delivery',
        'SHPMT': 'shipment',
        'SHPMNT': 'shipment',
        'SHPG': 'shipping',
        'FRT': 'freight',
        'FRGHT': 'freight',
        'TRNS': 'transport',
        'TRNSP': 'transport',
        'PKG': 'package',
        'PCKG': 'package',
        'PLT': 'pallet',

        # Credit/Financial
        'CR HLD': 'credit hold',
        'CRHLD': 'credit hold',
        'CR HOLD': 'credit hold',
        'CRDT': 'credit',
        'CRED': 'credit',
        'PMT': 'payment',
        'PYMT': 'payment',
        'INV': 'invoice',
        'INVCE': 'invoice',
        'BLNG': 'billing',
        'BLK': 'block',
        'BLKD': 'blocked',

        # Order Processing
        'ORD': 'order',
        'ORDR': 'order',
        'PO': 'purchase order',
        'SO': 'sales order',
        'DO': 'delivery order',
        'REQD': 'required',
        'RQST': 'request',
        'CONF': 'confirmation',
        'CNFRM': 'confirm',
        'CNFMD': 'confirmed',
        'APPRVD': 'approved',
        'APPRV': 'approve',
        'RJCT': 'reject',
        'RJCTD': 'rejected',
        'CNCL': 'cancel',
        'CNCLD': 'cancelled',

        # Materials/Inventory
        'MAT': 'material',
        'MATL': 'material',
        'MTRLS': 'materials',
        'INVTRY': 'inventory',
        'STK': 'stock',
        'QTY': 'quantity',
        'QNTY': 'quantity',
        'UM': 'unit of measure',
        'UOM': 'unit of measure',
        'EA': 'each',
        'PC': 'piece',
        'PCS': 'pieces',
        'CS': 'case',

        # Status/Actions
        'PNDG': 'pending',
        'PEND': 'pending',
        'PROC': 'processing',
        'PRCSD': 'processed',
        'CMPLT': 'complete',
        'CMPL': 'complete',
        'INCMPL': 'incomplete',
        'PRTL': 'partial',
        'PART': 'partial',
        'AVAIL': 'available',
        'UNAVL': 'unavailable',

        # Customer/Partner
        'CUSTMR': 'customer',
        'VNDR': 'vendor',
        'VEND': 'vendor',
        'SUPP': 'supplier',
        'SUPPL': 'supplier',
        'PTNR': 'partner',
        'PRTNR': 'partner',

        # Dates/Time
        'DT': 'date',
        'TM': 'time',
        'DLVRY DT': 'delivery date',
        'REQ DT': 'requested date',
        'SCHD': 'scheduled',
        'SCHED': 'scheduled',
        'ETA': 'estimated time of arrival',
        'ETD': 'estimated time of departure',

        # SAP-specific
        'VBELN': 'document number',
        'POSNR': 'item number',
        'MATNR': 'material number',
        'KUNNR': 'customer number',
        'LIFNR': 'vendor number',
        'WERKS': 'plant',
        'LGORT': 'storage location',
    }

    # SAP boilerplate patterns to remove
    # As per requirements: Strip "Created by batch", "System generated" etc.
    BOILERPLATE_PATTERNS: List[str] = [
        # System messages
        r'Message\s+no\.\s+\w+\d+',
        r'System\s+status:\s*\w+',
        r'Document\s+\d+\s+saved',
        r'Changes\s+saved\s+successfully',
        r'Processing\s+complete',
        r'No\s+data\s+found',
        r'Selection\s+criteria\s+not\s+met',

        # Required boilerplate patterns from spec
        r'Created\s+by\s+batch',
        r'System\s+generated',
        r'Auto[-\s]?generated',
        r'Automatically\s+created',
        r'Generated\s+by\s+system',
        r'Batch\s+job\s+\w+',
        r'Background\s+job',

        # Technical IDs and references
        r'Transaction:\s*\w+',
        r'Tcode:\s*\w+',
        r'T-code:\s*\w+',
        r'Report:\s*\w+',
        r'Program:\s*\w+',
        r'User:\s*\w+',
        r'Client:\s*\d+',
        r'System:\s*\w+',

        # Timestamps in technical format
        r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[Z.]?\d*',
        r'\d{2}:\d{2}:\d{2}\.\d+',

        # SAP internal codes
        r'SYST-\w+',
        r'SY-\w+',
        r'ICON_\w+',

        # Empty/placeholder text
        r'<\s*empty\s*>',
        r'\[empty\]',
        r'\(none\)',
        r'n/a',
        r'N/A',
        r'not applicable',
        r'no text',
        r'no notes',
        r'no comments',
    ]

    # Compiled boilerplate patterns
    _compiled_boilerplate: Optional[List[re.Pattern]] = None

    # Stop words to optionally remove
    STOP_WORDS: Set[str] = {
        'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
        'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
        'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
        'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'this',
        'that', 'these', 'those', 'it', 'its', 'they', 'them', 'their',
    }

    def __init__(
        self,
        lowercase: bool = True,
        remove_boilerplate: bool = True,
        expand_abbreviations: bool = True,
        remove_stop_words: bool = False,
        min_token_length: int = 2,
        custom_abbreviations: Optional[Dict[str, str]] = None
    ):
        """
        Initialize the text processor.

        Args:
            lowercase: Convert text to lowercase
            remove_boilerplate: Remove SAP boilerplate text
            expand_abbreviations: Expand common abbreviations
            remove_stop_words: Remove common stop words
            min_token_length: Minimum token length to keep
            custom_abbreviations: Additional abbreviations to expand
        """
        self.lowercase = lowercase
        self.remove_boilerplate = remove_boilerplate
        self.expand_abbreviations = expand_abbreviations
        self.remove_stop_words = remove_stop_words
        self.min_token_length = min_token_length

        # Build abbreviation dictionary
        self.abbreviations = self.ABBREVIATIONS.copy()
        if custom_abbreviations:
            self.abbreviations.update(custom_abbreviations)

        # Compile boilerplate patterns
        self._compile_boilerplate_patterns()

    def _compile_boilerplate_patterns(self):
        """Compile boilerplate regex patterns for efficiency."""
        self._compiled_boilerplate = [
            re.compile(pattern, re.IGNORECASE)
            for pattern in self.BOILERPLATE_PATTERNS
        ]

    def process(self, text: str) -> str:
        """
        Process and normalize text.

        Args:
            text: Input text to process

        Returns:
            Normalized text
        """
        if not text:
            return ""

        result = text

        # Remove boilerplate first
        if self.remove_boilerplate:
            result = self._remove_boilerplate(result)

        # Expand abbreviations before lowercasing
        if self.expand_abbreviations:
            result = self._expand_abbreviations(result)

        # Lowercase
        if self.lowercase:
            result = result.lower()

        # Clean up whitespace and punctuation
        result = self._clean_whitespace(result)

        # Remove stop words if configured
        if self.remove_stop_words:
            result = self._remove_stop_words(result)

        # Filter short tokens
        if self.min_token_length > 1:
            result = self._filter_short_tokens(result)

        return result.strip()

    def _remove_boilerplate(self, text: str) -> str:
        """Remove SAP boilerplate text patterns."""
        result = text
        for pattern in self._compiled_boilerplate:
            result = pattern.sub(' ', result)
        return result

    def _expand_abbreviations(self, text: str) -> str:
        """Expand known abbreviations."""
        result = text

        # Sort by length (longest first) to handle overlapping abbreviations
        sorted_abbrevs = sorted(
            self.abbreviations.items(),
            key=lambda x: len(x[0]),
            reverse=True
        )

        for abbrev, expansion in sorted_abbrevs:
            # Match whole words only (with word boundaries)
            pattern = re.compile(r'\b' + re.escape(abbrev) + r'\b', re.IGNORECASE)
            result = pattern.sub(expansion, result)

        return result

    def _clean_whitespace(self, text: str) -> str:
        """Clean up whitespace and normalize punctuation."""
        # Replace multiple whitespace with single space
        result = re.sub(r'\s+', ' ', text)

        # Remove excessive punctuation
        result = re.sub(r'[.]{2,}', '.', result)
        result = re.sub(r'[-]{2,}', '-', result)
        result = re.sub(r'[_]{2,}', '_', result)

        # Remove standalone punctuation
        result = re.sub(r'\s[^\w\s]\s', ' ', result)

        return result.strip()

    def _remove_stop_words(self, text: str) -> str:
        """Remove common stop words."""
        tokens = text.split()
        filtered = [t for t in tokens if t.lower() not in self.STOP_WORDS]
        return ' '.join(filtered)

    def _filter_short_tokens(self, text: str) -> str:
        """Remove tokens shorter than min_token_length."""
        tokens = text.split()
        filtered = [t for t in tokens if len(t) >= self.min_token_length]
        return ' '.join(filtered)

    def tokenize(self, text: str) -> List[str]:
        """
        Tokenize text into words.

        Args:
            text: Input text

        Returns:
            List of tokens
        """
        # Process the text first
        processed = self.process(text)

        # Split on whitespace and punctuation
        tokens = re.findall(r'\b\w+\b', processed)

        return tokens

    def get_ngrams(self, text: str, n: int = 2) -> List[str]:
        """
        Extract n-grams from text.

        Args:
            text: Input text
            n: N-gram size (default 2 for bigrams)

        Returns:
            List of n-grams as strings
        """
        tokens = self.tokenize(text)

        if len(tokens) < n:
            return []

        ngrams = []
        for i in range(len(tokens) - n + 1):
            ngram = ' '.join(tokens[i:i + n])
            ngrams.append(ngram)

        return ngrams

    def extract_phrases(self, text: str, min_words: int = 2, max_words: int = 4) -> List[str]:
        """
        Extract meaningful phrases from text.

        Args:
            text: Input text
            min_words: Minimum words in phrase
            max_words: Maximum words in phrase

        Returns:
            List of extracted phrases
        """
        phrases = []

        for n in range(min_words, max_words + 1):
            ngrams = self.get_ngrams(text, n)
            phrases.extend(ngrams)

        return phrases

    @classmethod
    def get_default_abbreviations(cls) -> Dict[str, str]:
        """Get the default abbreviation mappings."""
        return cls.ABBREVIATIONS.copy()


def normalize_text(text: str) -> str:
    """
    Convenience function for basic text normalization.

    Args:
        text: Input text

    Returns:
        Normalized text
    """
    processor = TextProcessor()
    return processor.process(text)


def tokenize(text: str) -> List[str]:
    """
    Convenience function for tokenization.

    Args:
        text: Input text

    Returns:
        List of tokens
    """
    processor = TextProcessor()
    return processor.tokenize(text)
