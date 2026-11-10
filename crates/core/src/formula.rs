//! The formula language a computed property's `expression` is written in.
//!
//! One small, typed language: a hand-written lexer and Pratt-style recursive
//! descent, a static type pass and an evaluation pass. Nothing here evaluates
//! source as code, allocates an interpreter loop or can panic on user input: a
//! malformed expression is a `422` from [`parse`], and a runtime mismatch — an
//! unset operand, a zero divisor, a malformed stored date — is an empty cell
//! from [`eval`].

use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};

use jiff::civil::Date;

use crate::error::CoreError;
use crate::model::{PropertyDef, PropertyFormat, Value};
use crate::schedule::{self, TimeZone};
use crate::value;

/// The longest expression, in characters.
pub const MAX_EXPRESSION_LEN: usize = 500;
/// The most tokens one expression may hold.
pub const MAX_TOKENS: usize = 512;
/// The deepest nesting of parentheses and call arguments.
pub const MAX_DEPTH: usize = 32;

/// The field every formula error is reported under.
const FIELD: &str = "compute.expression";

fn invalid(message: impl Into<String>) -> CoreError {
    CoreError::ValidationFailed {
        field: FIELD.to_owned(),
        message: message.into(),
    }
}

/// A parse error, positioned at the 1-based character where it was found.
fn at(source: &str, offset: usize, message: impl AsRef<str>) -> CoreError {
    let mut offset = offset.min(source.len());
    while !source.is_char_boundary(offset) {
        offset -= 1;
    }
    let character = source[..offset].chars().count() + 1;
    invalid(format!("{} at character {character}", message.as_ref()))
}

/// An expression tree.
#[derive(Debug, Clone, PartialEq)]
pub enum Expr {
    Number(f64),
    Text(String),
    Bool(bool),
    Reference(String),
    Unary(UnaryOp, Box<Expr>),
    Binary(BinaryOp, Box<Expr>, Box<Expr>),
    Call(String, Vec<Expr>),
}

/// A prefix operator.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnaryOp {
    Negate,
    Not,
}

/// An infix operator.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BinaryOp {
    Add,
    Subtract,
    Multiply,
    Divide,
    Modulo,
    Equal,
    NotEqual,
    Less,
    LessOrEqual,
    Greater,
    GreaterOrEqual,
    And,
    Or,
}

/// The five types a formula value can have.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ValueType {
    Text,
    Number,
    Checkbox,
    Date,
    DateTime,
}

impl ValueType {
    /// The type's spelling in an error message.
    pub fn name(self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Number => "a number",
            Self::Checkbox => "a checkbox",
            Self::Date => "a date",
            Self::DateTime => "a date and time",
        }
    }
}

/// What a reference resolves to: one typed value, or a property a formula may
/// not read (anything multi-valued).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reference {
    Single(ValueType),
    Multiple,
}

impl Reference {
    /// The reference a property offers a formula.
    pub fn of(property: &PropertyDef) -> Self {
        match property.format {
            PropertyFormat::Text
            | PropertyFormat::Select
            | PropertyFormat::Url
            | PropertyFormat::Email
            | PropertyFormat::File
            | PropertyFormat::Image => Self::Single(ValueType::Text),
            PropertyFormat::Number => Self::Single(ValueType::Number),
            PropertyFormat::Checkbox => Self::Single(ValueType::Checkbox),
            PropertyFormat::Date => Self::Single(ValueType::Date),
            PropertyFormat::Datetime => Self::Single(ValueType::DateTime),
            PropertyFormat::Relation if !property.multi => Self::Multiple,
            PropertyFormat::Relation
            | PropertyFormat::MultiSelect
            | PropertyFormat::Attachments
            | PropertyFormat::Recurrence
            | PropertyFormat::List => Self::Multiple,
        }
    }
}

/// The type of every property a formula of one type may name. `title` is
/// always text and is not listed.
#[derive(Debug, Clone, Copy)]
pub struct TypeContext<'a> {
    pub properties: &'a BTreeMap<String, Reference>,
}

impl<'a> TypeContext<'a> {
    pub fn new(properties: &'a BTreeMap<String, Reference>) -> Self {
        Self { properties }
    }

    fn value_type(&self, key: &str) -> Result<ValueType, CoreError> {
        if key == "title" {
            return Ok(ValueType::Text);
        }
        match self.properties.get(key) {
            Some(Reference::Single(value_type)) => Ok(*value_type),
            Some(Reference::Multiple) => Err(invalid(format!(
                "`{key}` is a multi-value property and cannot be referenced"
            ))),
            None => Err(invalid(format!("unknown property `{key}`"))),
        }
    }
}

// ── lexer ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
enum TokenKind {
    Number(f64),
    String(String),
    Ident(String),
    LParen,
    RParen,
    Comma,
    Plus,
    Minus,
    Star,
    Slash,
    Percent,
    Equal,
    NotEqual,
    Less,
    LessEqual,
    Greater,
    GreaterEqual,
    And,
    Or,
    Not,
    True,
    False,
    Eof,
}

#[derive(Debug, Clone)]
struct Token {
    kind: TokenKind,
    start: usize,
    end: usize,
}

/// Splits an expression into tokens, keeping each one's byte span so
/// [`rewrite`] can replace only the tokens it means.
fn lex(source: &str) -> Result<Vec<Token>, CoreError> {
    let mut tokens = Vec::new();
    let mut i = 0;
    while i < source.len() {
        let ch = source[i..].chars().next().expect("a char at a boundary");
        if ch.is_whitespace() {
            i += ch.len_utf8();
            continue;
        }
        let start = i;
        match ch {
            '"' => {
                i += 1;
                let mut text = String::new();
                loop {
                    let Some(current) = source[i..].chars().next() else {
                        return Err(at(source, start, "unterminated string"));
                    };
                    if current == '"' {
                        i += 1;
                        break;
                    }
                    if current == '\\' {
                        i += 1;
                        let Some(escaped) = source[i..].chars().next() else {
                            return Err(at(source, start, "unterminated string"));
                        };
                        match escaped {
                            '"' => text.push('"'),
                            '\\' => text.push('\\'),
                            other => {
                                return Err(at(
                                    source,
                                    i,
                                    format!("unsupported escape `\\{other}`"),
                                ));
                            }
                        }
                        i += escaped.len_utf8();
                        continue;
                    }
                    text.push(current);
                    i += current.len_utf8();
                }
                tokens.push(Token {
                    kind: TokenKind::String(text),
                    start,
                    end: i,
                });
            }
            '0'..='9' => {
                let mut seen_dot = false;
                while i < source.len() {
                    let current = source[i..].chars().next().expect("a char at a boundary");
                    if current.is_ascii_digit() {
                        i += 1;
                    } else if current == '.'
                        && !seen_dot
                        && source[i + 1..]
                            .chars()
                            .next()
                            .is_some_and(|next| next.is_ascii_digit())
                    {
                        seen_dot = true;
                        i += 1;
                    } else {
                        break;
                    }
                }
                let raw = &source[start..i];
                let number: f64 = raw
                    .parse()
                    .map_err(|_| at(source, start, "invalid number"))?;
                if !number.is_finite() {
                    return Err(at(source, start, "number is too large"));
                }
                tokens.push(Token {
                    kind: TokenKind::Number(number),
                    start,
                    end: i,
                });
            }
            'a'..='z' => {
                while i < source.len() {
                    let current = source[i..].chars().next().expect("a char at a boundary");
                    if current.is_ascii_lowercase() || current.is_ascii_digit() || current == '_' {
                        i += 1;
                    } else {
                        break;
                    }
                }
                let word = &source[start..i];
                let kind = match word {
                    "and" => TokenKind::And,
                    "or" => TokenKind::Or,
                    "not" => TokenKind::Not,
                    "true" => TokenKind::True,
                    "false" => TokenKind::False,
                    _ => TokenKind::Ident(word.to_owned()),
                };
                tokens.push(Token {
                    kind,
                    start,
                    end: i,
                });
            }
            _ => {
                let (kind, width) = match ch {
                    '(' => (TokenKind::LParen, 1),
                    ')' => (TokenKind::RParen, 1),
                    ',' => (TokenKind::Comma, 1),
                    '+' => (TokenKind::Plus, 1),
                    '-' => (TokenKind::Minus, 1),
                    '*' => (TokenKind::Star, 1),
                    '/' => (TokenKind::Slash, 1),
                    '%' => (TokenKind::Percent, 1),
                    '=' => (TokenKind::Equal, 1),
                    '<' if source[i + 1..].starts_with('=') => (TokenKind::LessEqual, 2),
                    '<' => (TokenKind::Less, 1),
                    '>' if source[i + 1..].starts_with('=') => (TokenKind::GreaterEqual, 2),
                    '>' => (TokenKind::Greater, 1),
                    '!' if source[i + 1..].starts_with('=') => (TokenKind::NotEqual, 2),
                    other => {
                        return Err(at(source, i, format!("unexpected character `{other}`")));
                    }
                };
                i += width;
                tokens.push(Token {
                    kind,
                    start,
                    end: i,
                });
            }
        }
    }
    tokens.push(Token {
        kind: TokenKind::Eof,
        start: source.len(),
        end: source.len(),
    });
    let count = tokens.len() - 1;
    if count > MAX_TOKENS {
        return Err(at(
            source,
            tokens[MAX_TOKENS].start,
            format!("expression has more than {MAX_TOKENS} tokens"),
        ));
    }
    Ok(tokens)
}

// ── parser ─────────────────────────────────────────────────────────────────

struct Parser<'a> {
    source: &'a str,
    tokens: Vec<Token>,
    pos: usize,
    depth: usize,
}

impl<'a> Parser<'a> {
    fn peek(&self) -> &TokenKind {
        &self.tokens[self.pos].kind
    }

    fn start(&self) -> usize {
        self.tokens[self.pos].start
    }

    fn advance(&mut self) -> Token {
        let token = self.tokens[self.pos].clone();
        if token.kind != TokenKind::Eof {
            self.pos += 1;
        }
        token
    }

    fn expect(&mut self, kind: TokenKind, what: &str) -> Result<Token, CoreError> {
        if std::mem::discriminant(self.peek()) == std::mem::discriminant(&kind) {
            Ok(self.advance())
        } else {
            Err(at(self.source, self.start(), format!("expected {what}")))
        }
    }

    fn enter(&mut self, offset: usize) -> Result<(), CoreError> {
        self.depth += 1;
        if self.depth > MAX_DEPTH {
            return Err(at(
                self.source,
                offset,
                format!("expression nests deeper than {MAX_DEPTH} levels"),
            ));
        }
        Ok(())
    }

    fn leave(&mut self) {
        self.depth -= 1;
    }

    fn parse(mut self) -> Result<Expr, CoreError> {
        let expr = self.parse_expr()?;
        if self.peek() != &TokenKind::Eof {
            return Err(at(
                self.source,
                self.start(),
                format!("unexpected {}", describe(self.peek())),
            ));
        }
        Ok(expr)
    }

    fn parse_expr(&mut self) -> Result<Expr, CoreError> {
        self.parse_or()
    }

    fn parse_or(&mut self) -> Result<Expr, CoreError> {
        let mut left = self.parse_and()?;
        while self.peek() == &TokenKind::Or {
            self.advance();
            let right = self.parse_and()?;
            left = Expr::Binary(BinaryOp::Or, Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    fn parse_and(&mut self) -> Result<Expr, CoreError> {
        let mut left = self.parse_not()?;
        while self.peek() == &TokenKind::And {
            self.advance();
            let right = self.parse_not()?;
            left = Expr::Binary(BinaryOp::And, Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    fn parse_not(&mut self) -> Result<Expr, CoreError> {
        if self.peek() == &TokenKind::Not {
            self.advance();
            return Ok(Expr::Unary(UnaryOp::Not, Box::new(self.parse_not()?)));
        }
        self.parse_comparison()
    }

    fn parse_comparison(&mut self) -> Result<Expr, CoreError> {
        let left = self.parse_additive()?;
        let op = match self.peek() {
            TokenKind::Equal => BinaryOp::Equal,
            TokenKind::NotEqual => BinaryOp::NotEqual,
            TokenKind::Less => BinaryOp::Less,
            TokenKind::LessEqual => BinaryOp::LessOrEqual,
            TokenKind::Greater => BinaryOp::Greater,
            TokenKind::GreaterEqual => BinaryOp::GreaterOrEqual,
            _ => return Ok(left),
        };
        self.advance();
        let right = self.parse_additive()?;
        Ok(Expr::Binary(op, Box::new(left), Box::new(right)))
    }

    fn parse_additive(&mut self) -> Result<Expr, CoreError> {
        let mut left = self.parse_multiplicative()?;
        loop {
            let op = match self.peek() {
                TokenKind::Plus => BinaryOp::Add,
                TokenKind::Minus => BinaryOp::Subtract,
                _ => break,
            };
            self.advance();
            let right = self.parse_multiplicative()?;
            left = Expr::Binary(op, Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    fn parse_multiplicative(&mut self) -> Result<Expr, CoreError> {
        let mut left = self.parse_unary()?;
        loop {
            let op = match self.peek() {
                TokenKind::Star => BinaryOp::Multiply,
                TokenKind::Slash => BinaryOp::Divide,
                TokenKind::Percent => BinaryOp::Modulo,
                _ => break,
            };
            self.advance();
            let right = self.parse_unary()?;
            left = Expr::Binary(op, Box::new(left), Box::new(right));
        }
        Ok(left)
    }

    fn parse_unary(&mut self) -> Result<Expr, CoreError> {
        if self.peek() == &TokenKind::Minus {
            self.advance();
            return Ok(Expr::Unary(UnaryOp::Negate, Box::new(self.parse_unary()?)));
        }
        self.parse_primary()
    }

    fn parse_primary(&mut self) -> Result<Expr, CoreError> {
        match self.peek().clone() {
            TokenKind::Number(number) => {
                self.advance();
                Ok(Expr::Number(number))
            }
            TokenKind::String(text) => {
                self.advance();
                Ok(Expr::Text(text))
            }
            TokenKind::True => {
                self.advance();
                Ok(Expr::Bool(true))
            }
            TokenKind::False => {
                self.advance();
                Ok(Expr::Bool(false))
            }
            TokenKind::Ident(name) => {
                self.advance();
                if self.peek() != &TokenKind::LParen {
                    return Ok(Expr::Reference(name));
                }
                let offset = self.start();
                self.advance();
                self.enter(offset)?;
                let mut args = Vec::new();
                if self.peek() != &TokenKind::RParen {
                    loop {
                        args.push(self.parse_expr()?);
                        if self.peek() == &TokenKind::Comma {
                            self.advance();
                            continue;
                        }
                        break;
                    }
                }
                self.expect(TokenKind::RParen, "`)`")?;
                self.leave();
                Ok(Expr::Call(name, args))
            }
            TokenKind::LParen => {
                let offset = self.start();
                self.advance();
                self.enter(offset)?;
                let expr = self.parse_expr()?;
                self.expect(TokenKind::RParen, "`)`")?;
                self.leave();
                Ok(expr)
            }
            ref other => Err(at(
                self.source,
                self.start(),
                format!("expected an expression, found {}", describe(other)),
            )),
        }
    }
}

/// A token's spelling for an error message.
fn describe(kind: &TokenKind) -> String {
    match kind {
        TokenKind::Number(_) => "a number".to_owned(),
        TokenKind::String(_) => "a string".to_owned(),
        TokenKind::Ident(name) => format!("`{name}`"),
        TokenKind::LParen => "`(`".to_owned(),
        TokenKind::RParen => "`)`".to_owned(),
        TokenKind::Comma => "`,`".to_owned(),
        TokenKind::Plus => "`+`".to_owned(),
        TokenKind::Minus => "`-`".to_owned(),
        TokenKind::Star => "`*`".to_owned(),
        TokenKind::Slash => "`/`".to_owned(),
        TokenKind::Percent => "`%`".to_owned(),
        TokenKind::Equal => "`=`".to_owned(),
        TokenKind::NotEqual => "`!=`".to_owned(),
        TokenKind::Less => "`<`".to_owned(),
        TokenKind::LessEqual => "`<=`".to_owned(),
        TokenKind::Greater => "`>`".to_owned(),
        TokenKind::GreaterEqual => "`>=`".to_owned(),
        TokenKind::And => "`and`".to_owned(),
        TokenKind::Or => "`or`".to_owned(),
        TokenKind::Not => "`not`".to_owned(),
        TokenKind::True => "`true`".to_owned(),
        TokenKind::False => "`false`".to_owned(),
        TokenKind::Eof => "the end".to_owned(),
    }
}

/// Parses one expression. Every error is a [`CoreError::ValidationFailed`]
/// under `compute.expression` and names the character where it was found.
pub fn parse(expression: &str) -> Result<Expr, CoreError> {
    let length = expression.chars().count();
    if length > MAX_EXPRESSION_LEN {
        return Err(at(
            expression,
            MAX_EXPRESSION_LEN,
            format!("expression is longer than {MAX_EXPRESSION_LEN} characters"),
        ));
    }
    let tokens = lex(expression)?;
    Parser {
        source: expression,
        tokens,
        pos: 0,
        depth: 0,
    }
    .parse()
}

// ── static types ───────────────────────────────────────────────────────────

/// Infers an expression's type, refusing an unknown reference, a multi-value
/// reference and every operator or call whose operands do not fit.
pub fn infer(expr: &Expr, context: &TypeContext<'_>) -> Result<ValueType, CoreError> {
    match expr {
        Expr::Number(_) => Ok(ValueType::Number),
        Expr::Text(_) => Ok(ValueType::Text),
        Expr::Bool(_) => Ok(ValueType::Checkbox),
        Expr::Reference(key) => context.value_type(key),
        Expr::Unary(op, operand) => {
            let found = infer(operand, context)?;
            match op {
                UnaryOp::Negate if found == ValueType::Number => Ok(ValueType::Number),
                UnaryOp::Not if found == ValueType::Checkbox => Ok(ValueType::Checkbox),
                UnaryOp::Negate => Err(invalid(format!(
                    "`-` expects a number, found {}",
                    found.name()
                ))),
                UnaryOp::Not => Err(invalid(format!(
                    "`not` expects a checkbox, found {}",
                    found.name()
                ))),
            }
        }
        Expr::Binary(op, left, right) => {
            let left_type = infer(left, context)?;
            let right_type = infer(right, context)?;
            infer_binary(*op, left_type, right_type)
        }
        Expr::Call(name, args) => {
            let types = args
                .iter()
                .map(|arg| infer(arg, context))
                .collect::<Result<Vec<_>, _>>()?;
            infer_call(name, &types)
        }
    }
}

fn expect(type_: ValueType, expected: ValueType, what: &str) -> Result<ValueType, CoreError> {
    if type_ == expected {
        Ok(type_)
    } else {
        Err(invalid(format!(
            "`{what}` expects {}, found {}",
            expected.name(),
            type_.name()
        )))
    }
}

fn infer_binary(op: BinaryOp, left: ValueType, right: ValueType) -> Result<ValueType, CoreError> {
    match op {
        BinaryOp::Add => {
            if left == ValueType::Text || right == ValueType::Text {
                Ok(ValueType::Text)
            } else if left == ValueType::Number && right == ValueType::Number {
                Ok(ValueType::Number)
            } else {
                Err(invalid(format!(
                    "`+` needs two numbers or text, found {} and {}",
                    left.name(),
                    right.name()
                )))
            }
        }
        BinaryOp::Subtract | BinaryOp::Multiply | BinaryOp::Divide | BinaryOp::Modulo => {
            let symbol = match op {
                BinaryOp::Subtract => "-",
                BinaryOp::Multiply => "*",
                BinaryOp::Divide => "/",
                _ => "%",
            };
            expect(left, ValueType::Number, symbol)?;
            expect(right, ValueType::Number, symbol)?;
            Ok(ValueType::Number)
        }
        BinaryOp::And | BinaryOp::Or => {
            let symbol = if op == BinaryOp::And { "and" } else { "or" };
            expect(left, ValueType::Checkbox, symbol)?;
            expect(right, ValueType::Checkbox, symbol)?;
            Ok(ValueType::Checkbox)
        }
        BinaryOp::Equal
        | BinaryOp::NotEqual
        | BinaryOp::Less
        | BinaryOp::LessOrEqual
        | BinaryOp::Greater
        | BinaryOp::GreaterOrEqual => {
            if left != right {
                return Err(invalid(format!(
                    "cannot compare {} with {}",
                    left.name(),
                    right.name()
                )));
            }
            Ok(ValueType::Checkbox)
        }
    }
}

fn check_arity(name: &str, found: usize, min: usize, max: Option<usize>) -> Result<(), CoreError> {
    let fits = found >= min && max.is_none_or(|max| found <= max);
    if fits {
        return Ok(());
    }
    let expected = match max {
        Some(max) if max == min => format!("{min}"),
        Some(max) => format!("{min} to {max}"),
        None => format!("at least {min}"),
    };
    Err(invalid(format!(
        "`{name}` takes {expected} argument{}, found {found}",
        if expected == "1" { "" } else { "s" }
    )))
}

fn infer_call(name: &str, types: &[ValueType]) -> Result<ValueType, CoreError> {
    match name {
        "if" => {
            check_arity(name, types.len(), 3, Some(3))?;
            expect(types[0], ValueType::Checkbox, "if")?;
            if types[1] != types[2] {
                return Err(invalid(format!(
                    "`if` branches must have the same type, found {} and {}",
                    types[1].name(),
                    types[2].name()
                )));
            }
            Ok(types[1])
        }
        "round" => {
            check_arity(name, types.len(), 1, Some(2))?;
            for type_ in types {
                expect(*type_, ValueType::Number, name)?;
            }
            Ok(ValueType::Number)
        }
        "abs" => {
            check_arity(name, types.len(), 1, Some(1))?;
            expect(types[0], ValueType::Number, name)?;
            Ok(ValueType::Number)
        }
        "min" | "max" => {
            check_arity(name, types.len(), 2, None)?;
            for type_ in types {
                expect(*type_, ValueType::Number, name)?;
            }
            Ok(ValueType::Number)
        }
        "length" => {
            check_arity(name, types.len(), 1, Some(1))?;
            expect(types[0], ValueType::Text, name)?;
            Ok(ValueType::Number)
        }
        "lower" | "upper" => {
            check_arity(name, types.len(), 1, Some(1))?;
            expect(types[0], ValueType::Text, name)?;
            Ok(ValueType::Text)
        }
        "days" => {
            check_arity(name, types.len(), 2, Some(2))?;
            for type_ in types {
                if !matches!(type_, ValueType::Date | ValueType::DateTime) {
                    return Err(invalid(format!(
                        "`days` expects dates or date-times, found {}",
                        type_.name()
                    )));
                }
            }
            Ok(ValueType::Number)
        }
        "today" => {
            check_arity(name, types.len(), 0, Some(0))?;
            Ok(ValueType::Date)
        }
        other => Err(invalid(format!("unknown function `{other}`"))),
    }
}

// ── evaluation ─────────────────────────────────────────────────────────────

/// The values one evaluation reads: the record's stored properties and their
/// formats, its title, and the request's day and zone.
pub struct EvalContext<'a> {
    pub properties: &'a BTreeMap<String, Value>,
    pub formats: &'a BTreeMap<String, PropertyFormat>,
    pub title: &'a str,
    pub today: Date,
    pub timezone: &'a TimeZone,
}

/// A typed formula value. Dates and date-times keep their stored spelling, as
/// the format does, so concatenation renders them exactly.
#[derive(Debug, Clone, PartialEq)]
enum Eval {
    Text(String),
    Number(f64),
    Bool(bool),
    Date(String),
    DateTime(String),
}

impl Eval {
    fn render(&self) -> String {
        match self {
            Self::Text(text) | Self::Date(text) | Self::DateTime(text) => text.clone(),
            Self::Number(number) => value::number_label(*number),
            Self::Bool(flag) => flag.to_string(),
        }
    }

    fn into_value(self) -> Value {
        match self {
            Self::Text(text) | Self::Date(text) | Self::DateTime(text) => Value::Text(text),
            Self::Number(number) => Value::Number(number),
            Self::Bool(flag) => Value::Bool(flag),
        }
    }
}

/// Evaluates an expression. `None` is the empty cell: an unset operand, a
/// zero divisor, a malformed stored date or any other runtime mismatch.
pub fn eval(expr: &Expr, context: &EvalContext<'_>) -> Option<Value> {
    eval_typed(expr, context).map(Eval::into_value)
}

fn eval_typed(expr: &Expr, context: &EvalContext<'_>) -> Option<Eval> {
    match expr {
        Expr::Number(number) => Some(Eval::Number(*number)),
        Expr::Text(text) => Some(Eval::Text(text.clone())),
        Expr::Bool(flag) => Some(Eval::Bool(*flag)),
        Expr::Reference(key) => read_reference(key, context),
        Expr::Unary(op, operand) => {
            let value = eval_typed(operand, context)?;
            match (op, value) {
                (UnaryOp::Negate, Eval::Number(number)) => {
                    let negated = -number;
                    negated.is_finite().then_some(Eval::Number(negated))
                }
                (UnaryOp::Not, Eval::Bool(flag)) => Some(Eval::Bool(!flag)),
                _ => None,
            }
        }
        Expr::Binary(op, left, right) => eval_binary(*op, left, right, context),
        Expr::Call(name, args) => eval_call(name, args, context),
    }
}

fn read_reference(key: &str, context: &EvalContext<'_>) -> Option<Eval> {
    if key == "title" {
        return Some(Eval::Text(context.title.to_owned()));
    }
    let value = context.properties.get(key)?;
    match (context.formats.get(key)?, value) {
        (
            PropertyFormat::Text
            | PropertyFormat::Select
            | PropertyFormat::Url
            | PropertyFormat::Email
            | PropertyFormat::File
            | PropertyFormat::Image,
            Value::Text(text),
        ) => Some(Eval::Text(text.clone())),
        (PropertyFormat::Number, Value::Number(number)) => Some(Eval::Number(*number)),
        (PropertyFormat::Checkbox, Value::Bool(flag)) => Some(Eval::Bool(*flag)),
        (PropertyFormat::Date, Value::Text(text)) => {
            value::parse_date(text)?;
            Some(Eval::Date(text.clone()))
        }
        (PropertyFormat::Datetime, Value::Text(text)) => {
            value::parse_datetime(text)?;
            Some(Eval::DateTime(text.clone()))
        }
        _ => None,
    }
}

fn eval_binary(op: BinaryOp, left: &Expr, right: &Expr, context: &EvalContext<'_>) -> Option<Eval> {
    match op {
        BinaryOp::And => match eval_typed(left, context) {
            Some(Eval::Bool(false)) | None => Some(Eval::Bool(false)),
            Some(Eval::Bool(true)) => match eval_typed(right, context) {
                Some(Eval::Bool(flag)) => Some(Eval::Bool(flag)),
                None => Some(Eval::Bool(false)),
                _ => None,
            },
            _ => None,
        },
        BinaryOp::Or => match eval_typed(left, context) {
            Some(Eval::Bool(true)) => Some(Eval::Bool(true)),
            Some(Eval::Bool(false)) | None => match eval_typed(right, context) {
                Some(Eval::Bool(flag)) => Some(Eval::Bool(flag)),
                None => Some(Eval::Bool(false)),
                _ => None,
            },
            _ => None,
        },
        _ => {
            let left = eval_typed(left, context)?;
            let right = eval_typed(right, context)?;
            match op {
                BinaryOp::Add => add(left, right),
                BinaryOp::Subtract => arithmetic(left, right, |a, b| Some(a - b)),
                BinaryOp::Multiply => arithmetic(left, right, |a, b| Some(a * b)),
                BinaryOp::Divide => arithmetic(left, right, |a, b| (b != 0.0).then_some(a / b)),
                BinaryOp::Modulo => arithmetic(left, right, |a, b| (b != 0.0).then_some(a % b)),
                BinaryOp::Equal => Some(Eval::Bool(values_equal(&left, &right)?)),
                BinaryOp::NotEqual => Some(Eval::Bool(!values_equal(&left, &right)?)),
                BinaryOp::Less => {
                    Some(Eval::Bool(values_compare(&left, &right)? == Ordering::Less))
                }
                BinaryOp::LessOrEqual => Some(Eval::Bool(
                    values_compare(&left, &right)? != Ordering::Greater,
                )),
                BinaryOp::Greater => Some(Eval::Bool(
                    values_compare(&left, &right)? == Ordering::Greater,
                )),
                BinaryOp::GreaterOrEqual => {
                    Some(Eval::Bool(values_compare(&left, &right)? != Ordering::Less))
                }
                BinaryOp::And | BinaryOp::Or => unreachable!("handled above"),
            }
        }
    }
}

fn add(left: Eval, right: Eval) -> Option<Eval> {
    match (&left, &right) {
        (Eval::Text(_), _) | (_, Eval::Text(_)) => {
            Some(Eval::Text(left.render() + &right.render()))
        }
        (Eval::Number(a), Eval::Number(b)) => {
            let sum = a + b;
            sum.is_finite().then_some(Eval::Number(sum))
        }
        _ => None,
    }
}

fn arithmetic(left: Eval, right: Eval, compute: impl Fn(f64, f64) -> Option<f64>) -> Option<Eval> {
    let (Eval::Number(left), Eval::Number(right)) = (left, right) else {
        return None;
    };
    compute(left, right)
        .filter(|number| number.is_finite())
        .map(Eval::Number)
}

fn values_equal(left: &Eval, right: &Eval) -> Option<bool> {
    match (left, right) {
        (Eval::Text(left), Eval::Text(right)) => {
            Some(value::text_equals(PropertyFormat::Text, left, right))
        }
        (Eval::Number(left), Eval::Number(right)) => Some(left == right),
        (Eval::Bool(left), Eval::Bool(right)) => Some(left == right),
        (Eval::Date(left), Eval::Date(right)) => {
            Some(value::parse_date(left)? == value::parse_date(right)?)
        }
        (Eval::DateTime(left), Eval::DateTime(right)) => {
            Some(value::parse_datetime(left)? == value::parse_datetime(right)?)
        }
        _ => None,
    }
}

fn values_compare(left: &Eval, right: &Eval) -> Option<Ordering> {
    match (left, right) {
        (Eval::Text(left), Eval::Text(right)) => Some(value::compare_text(left, right)),
        (Eval::Number(left), Eval::Number(right)) => left.partial_cmp(right),
        (Eval::Bool(left), Eval::Bool(right)) => Some(left.cmp(right)),
        (Eval::Date(left), Eval::Date(right)) => {
            Some(value::parse_date(left)?.cmp(&value::parse_date(right)?))
        }
        (Eval::DateTime(left), Eval::DateTime(right)) => {
            Some(value::parse_datetime(left)?.cmp(&value::parse_datetime(right)?))
        }
        _ => None,
    }
}

fn eval_call(name: &str, args: &[Expr], context: &EvalContext<'_>) -> Option<Eval> {
    match name {
        "if" if args.len() == 3 => {
            let condition = eval_typed(&args[0], context);
            if matches!(condition, Some(Eval::Bool(true))) {
                eval_typed(&args[1], context)
            } else {
                eval_typed(&args[2], context)
            }
        }
        "round" if !args.is_empty() && args.len() <= 2 => {
            let Some(Eval::Number(number)) = eval_typed(&args[0], context) else {
                return None;
            };
            let digits = match args.get(1) {
                None => 0,
                Some(expr) => match eval_typed(expr, context) {
                    Some(Eval::Number(digits))
                        if digits.fract() == 0.0 && (-15.0..=15.0).contains(&digits) =>
                    {
                        digits as i32
                    }
                    _ => return None,
                },
            };
            let factor = 10f64.powi(digits);
            if !factor.is_finite() || factor == 0.0 {
                return None;
            }
            let rounded = (number * factor).round() / factor;
            rounded.is_finite().then_some(Eval::Number(rounded))
        }
        "abs" if args.len() == 1 => match eval_typed(&args[0], context) {
            Some(Eval::Number(number)) => Some(Eval::Number(number.abs())),
            _ => None,
        },
        "min" | "max" if args.len() >= 2 => {
            let mut numbers = Vec::with_capacity(args.len());
            for arg in args {
                match eval_typed(arg, context) {
                    Some(Eval::Number(number)) => numbers.push(number),
                    _ => return None,
                }
            }
            let result = if name == "min" {
                numbers.into_iter().fold(f64::INFINITY, f64::min)
            } else {
                numbers.into_iter().fold(f64::NEG_INFINITY, f64::max)
            };
            result.is_finite().then_some(Eval::Number(result))
        }
        "length" if args.len() == 1 => match eval_typed(&args[0], context) {
            Some(Eval::Text(text)) => Some(Eval::Number(text.chars().count() as f64)),
            _ => None,
        },
        "lower" if args.len() == 1 => match eval_typed(&args[0], context) {
            Some(Eval::Text(text)) => Some(Eval::Text(text.to_lowercase())),
            _ => None,
        },
        "upper" if args.len() == 1 => match eval_typed(&args[0], context) {
            Some(Eval::Text(text)) => Some(Eval::Text(text.to_uppercase())),
            _ => None,
        },
        "days" if args.len() == 2 => {
            let from = calendar_date(&eval_typed(&args[0], context)?, context)?;
            let to = calendar_date(&eval_typed(&args[1], context)?, context)?;
            let days = to.since(from).ok()?.get_days();
            Some(Eval::Number(days as f64))
        }
        "today" if args.is_empty() => Some(Eval::Date(context.today.to_string())),
        _ => None,
    }
}

/// The calendar day an operand names, converting a date-time through the
/// space's zone before the whole-day subtraction.
fn calendar_date(value: &Eval, context: &EvalContext<'_>) -> Option<Date> {
    match value {
        Eval::Date(text) => text.parse().ok(),
        Eval::DateTime(text) => {
            let instant = value::parse_datetime(text)?;
            Some(
                schedule::timestamp(instant)
                    .to_zoned(context.timezone.clone())
                    .date(),
            )
        }
        _ => None,
    }
}

// ── reference scanning and rewriting ───────────────────────────────────────

/// Every property key the expression reads, in order. Function names and the
/// virtual `title` are included/excluded exactly as the parser saw them.
pub fn references(expr: &Expr) -> BTreeSet<&str> {
    fn walk<'a>(expr: &'a Expr, found: &mut BTreeSet<&'a str>) {
        match expr {
            Expr::Reference(key) => {
                found.insert(key.as_str());
            }
            Expr::Unary(_, operand) => walk(operand, found),
            Expr::Binary(_, left, right) => {
                walk(left, found);
                walk(right, found);
            }
            Expr::Call(_, args) => {
                for arg in args {
                    walk(arg, found);
                }
            }
            Expr::Number(_) | Expr::Text(_) | Expr::Bool(_) => {}
        }
    }
    let mut found = BTreeSet::new();
    walk(expr, &mut found);
    found
}

/// Rewrites every reference identifier spelled `old` to `new`, preserving every
/// other byte exactly. A function name is not a reference, so a call keeps its
/// spelling even when a property shares it. `None` when nothing changed or the
/// source does not lex.
pub fn rewrite(expression: &str, old: &str, new: &str) -> Option<String> {
    if old == new {
        return None;
    }
    let tokens = lex(expression).ok()?;
    let mut output = String::with_capacity(expression.len());
    let mut last = 0;
    let mut changed = false;
    for (index, token) in tokens.iter().enumerate() {
        if let TokenKind::Ident(name) = &token.kind
            && name == old
            && tokens
                .get(index + 1)
                .is_none_or(|next| next.kind != TokenKind::LParen)
        {
            output.push_str(&expression[last..token.start]);
            output.push_str(new);
            last = token.end;
            changed = true;
        }
    }
    if !changed {
        return None;
    }
    output.push_str(&expression[last..]);
    Some(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn values(entries: &[(&str, Value)]) -> BTreeMap<String, Value> {
        entries
            .iter()
            .map(|(key, value)| ((*key).to_owned(), value.clone()))
            .collect()
    }

    fn formats(entries: &[(&str, PropertyFormat)]) -> BTreeMap<String, PropertyFormat> {
        entries
            .iter()
            .map(|(key, format)| ((*key).to_owned(), *format))
            .collect()
    }

    fn today() -> Date {
        "2026-11-10".parse().expect("a date")
    }

    fn run(
        expression: &str,
        property_entries: &[(&str, Value)],
        format_entries: &[(&str, PropertyFormat)],
    ) -> Option<Value> {
        let properties = values(property_entries);
        let formats = formats(format_entries);
        let timezone = TimeZone::get("UTC").expect("a time zone");
        let context = EvalContext {
            properties: &properties,
            formats: &formats,
            title: "Monstera",
            today: today(),
            timezone: &timezone,
        };
        eval(&parse(expression).expect("the expression parses"), &context)
    }

    fn number(n: f64) -> Option<Value> {
        Some(Value::Number(n))
    }

    fn text(s: &str) -> Option<Value> {
        Some(Value::Text(s.to_owned()))
    }

    fn reference_types(entries: &[(&str, Reference)]) -> BTreeMap<String, Reference> {
        entries
            .iter()
            .map(|(key, reference)| ((*key).to_owned(), *reference))
            .collect()
    }

    fn infer_with(expression: &str, types: &[(&str, Reference)]) -> Result<ValueType, CoreError> {
        let types = reference_types(types);
        infer(
            &parse(expression).expect("the expression parses"),
            &TypeContext::new(&types),
        )
    }

    #[test]
    fn precedence_follows_the_grammar() {
        assert_eq!(run("1 + 2 * 3", &[], &[]), number(7.0));
        assert_eq!(run("(1 + 2) * 3", &[], &[]), number(9.0));
        assert_eq!(run("-2 * 3 + 10", &[], &[]), number(4.0));
        assert_eq!(run("--2", &[], &[]), number(2.0));
        assert_eq!(
            run(
                "not done and done",
                &[("done", Value::Bool(false))],
                &[("done", PropertyFormat::Checkbox)],
            ),
            Some(Value::Bool(false))
        );
        assert_eq!(
            run(
                "a < b or c < d",
                &[("a", Value::Number(1.0)), ("b", Value::Number(2.0))],
                &[
                    ("a", PropertyFormat::Number),
                    ("b", PropertyFormat::Number),
                    ("c", PropertyFormat::Number),
                    ("d", PropertyFormat::Number),
                ],
            ),
            Some(Value::Bool(true)),
            "an unset c < d is false, so the first comparison decides"
        );
    }

    #[test]
    fn strings_concatenate_and_render_each_type() {
        assert_eq!(
            run(r#""a\"b\\c""#, &[], &[]),
            text("a\"b\\c"),
            "the two supported escapes decode"
        );
        assert_eq!(
            run(
                r#""count: " + count"#,
                &[
                    ("count", Value::Number(7.0)),
                    ("done", Value::Bool(true)),
                    ("due", Value::Text("2026-11-10".to_owned())),
                    ("price", Value::Number(7.5)),
                ],
                &[
                    ("count", PropertyFormat::Number),
                    ("done", PropertyFormat::Checkbox),
                    ("due", PropertyFormat::Date),
                    ("price", PropertyFormat::Number),
                ],
            ),
            text("count: 7")
        );
        assert_eq!(
            run(
                r#""done: " + done"#,
                &[("done", Value::Bool(true))],
                &[("done", PropertyFormat::Checkbox)],
            ),
            text("done: true")
        );
        assert_eq!(
            run(
                r#""due " + due"#,
                &[("due", Value::Text("2026-11-10".to_owned()))],
                &[("due", PropertyFormat::Date)],
            ),
            text("due 2026-11-10"),
            "a date renders exactly as stored"
        );
        assert_eq!(
            run(
                r#""price: " + price"#,
                &[("price", Value::Number(7.5))],
                &[("price", PropertyFormat::Number)],
            ),
            text("price: 7.5")
        );
    }

    #[test]
    fn comparisons_honour_each_types_order() {
        assert_eq!(
            run(
                "a < b",
                &[("a", Value::Number(2.0)), ("b", Value::Number(10.0))],
                &[("a", PropertyFormat::Number), ("b", PropertyFormat::Number)],
            ),
            Some(Value::Bool(true)),
            "numbers compare numerically, not as text"
        );
        assert_eq!(
            run(
                "name = other",
                &[
                    ("name", Value::Text("Fern".to_owned())),
                    ("other", Value::Text("fern".to_owned()))
                ],
                &[
                    ("name", PropertyFormat::Text),
                    ("other", PropertyFormat::Text)
                ],
            ),
            Some(Value::Bool(true)),
            "text equality is case-insensitive"
        );
        assert_eq!(
            run(
                "due < later",
                &[
                    ("due", Value::Text("2026-11-09".to_owned())),
                    ("later", Value::Text("2026-11-10".to_owned()))
                ],
                &[
                    ("due", PropertyFormat::Date),
                    ("later", PropertyFormat::Date)
                ],
            ),
            Some(Value::Bool(true))
        );
        assert_eq!(
            run(
                "seen >= later",
                &[
                    ("seen", Value::Text("2026-11-10T08:00:00Z".to_owned())),
                    ("later", Value::Text("2026-11-10T07:00:00Z".to_owned()))
                ],
                &[
                    ("seen", PropertyFormat::Datetime),
                    ("later", PropertyFormat::Datetime)
                ],
            ),
            Some(Value::Bool(true))
        );
        assert_eq!(
            run(
                "done != other",
                &[("done", Value::Bool(true)), ("other", Value::Bool(false))],
                &[
                    ("done", PropertyFormat::Checkbox),
                    ("other", PropertyFormat::Checkbox)
                ],
            ),
            Some(Value::Bool(true))
        );
    }

    #[test]
    fn if_is_lazy_and_treats_an_empty_condition_as_false() {
        assert_eq!(run("if(true, 1, 1 / 0)", &[], &[]), number(1.0));
        assert_eq!(run("if(false, 1, 1 / 0)", &[], &[]), None);
        assert_eq!(
            run("if(flag, 1, 2)", &[], &[("flag", PropertyFormat::Checkbox)]),
            number(2.0),
            "an unset condition takes the else branch"
        );
    }

    #[test]
    fn functions_compute_their_documented_results() {
        assert_eq!(run("round(2.5)", &[], &[]), number(3.0));
        assert_eq!(run("round(2.345, 2)", &[], &[]), number(2.35));
        assert_eq!(run("abs(-3)", &[], &[]), number(3.0));
        assert_eq!(run("min(3, 1, 2)", &[], &[]), number(1.0));
        assert_eq!(run("max(3, 1, 2)", &[], &[]), number(3.0));
        assert_eq!(run(r#"length("Fern")"#, &[], &[]), number(4.0));
        assert_eq!(run(r#"lower("FERN")"#, &[], &[]), text("fern"));
        assert_eq!(run(r#"upper("fern")"#, &[], &[]), text("FERN"));
        assert_eq!(run("today()", &[], &[]), text("2026-11-10"));
        assert_eq!(
            run(
                "days(earlier, later)",
                &[
                    ("earlier", Value::Text("2026-11-07".to_owned())),
                    ("later", Value::Text("2026-11-10".to_owned())),
                ],
                &[
                    ("earlier", PropertyFormat::Date),
                    ("later", PropertyFormat::Date),
                ],
            ),
            number(3.0)
        );
    }

    #[test]
    fn days_converts_a_datetime_through_the_space_zone() {
        let properties = values(&[
            ("due", Value::Text("2026-11-09".to_owned())),
            ("seen", Value::Text("2026-11-10T02:00:00Z".to_owned())),
        ]);
        let formats = formats(&[
            ("due", PropertyFormat::Date),
            ("seen", PropertyFormat::Datetime),
        ]);
        let timezone = TimeZone::get("America/Toronto").expect("a time zone");
        let context = EvalContext {
            properties: &properties,
            formats: &formats,
            title: "Monstera",
            today: today(),
            timezone: &timezone,
        };
        assert_eq!(
            eval(&parse("days(due, seen)").expect("parses"), &context),
            number(0.0),
            "02:00Z is still the previous day in Toronto"
        );
    }

    #[test]
    fn runtime_misses_are_empty_cells() {
        assert_eq!(run("1 / 0", &[], &[]), None);
        assert_eq!(run("1 % 0", &[], &[]), None);
        assert_eq!(
            run("count + 1", &[], &[("count", PropertyFormat::Number)]),
            None,
            "an unset operand is empty"
        );
        assert_eq!(
            run(
                "due",
                &[("due", Value::Text("not a date".to_owned()))],
                &[("due", PropertyFormat::Date)],
            ),
            None,
            "a malformed stored date is empty"
        );
        assert_eq!(
            run(
                "seen + 1",
                &[("seen", Value::Text("2026-11-10".to_owned()))],
                &[("seen", PropertyFormat::Datetime)],
            ),
            None
        );
    }

    #[test]
    fn static_types_refuse_what_the_language_cannot_mean() {
        let unknown = infer_with("missing + 1", &[]).expect_err("unknown reference");
        assert_eq!(
            unknown.to_string(),
            "invalid compute.expression: unknown property `missing`"
        );

        let multiple = infer_with("tags", &[("tags", Reference::Multiple)])
            .expect_err("multi-value reference");
        assert!(multiple.to_string().contains("multi-value"), "{multiple}");

        assert_eq!(
            infer_with("1 + 2", &[]).expect("a number"),
            ValueType::Number
        );
        assert_eq!(
            infer_with("true and not false", &[]).expect("a checkbox"),
            ValueType::Checkbox
        );
        assert_eq!(
            infer_with(r#""x" + 1"#, &[]).expect("text concatenation"),
            ValueType::Text
        );
        assert_eq!(infer_with("today()", &[]).expect("a date"), ValueType::Date);
        assert_eq!(
            infer_with("days(today(), today())", &[]).expect("a number"),
            ValueType::Number
        );

        for bad in [
            "if(true, 1, \"x\")",
            "not 1",
            "1 < \"x\"",
            "round(1, 2, 3)",
            "round(\"x\")",
            "min(1)",
            "lower(1)",
            "days(1, 2)",
            "unknown()",
            "1 + true",
            "1 / true",
            "true + 1 and false",
        ] {
            let error = infer_with(bad, &[]).expect_err(bad);
            assert_eq!(
                format!("{:?}", error.field_of()),
                format!("{:?}", Some(FIELD)),
                "{bad}: {error}"
            );
        }
    }

    #[test]
    fn parse_errors_name_the_character() {
        for (expression, fragment) in [
            ("1 +", "expected an expression"),
            ("(1", "expected `)`"),
            ("1 2", "unexpected a number"),
            ("\"open", "unterminated string"),
            ("@", "unexpected character `@`"),
            ("1 ! 2", "unexpected character `!`"),
            ("1.", "unexpected character `.`"),
        ] {
            let error = parse(expression).expect_err(expression).to_string();
            assert!(error.contains(fragment), "{expression}: {error}");
            assert!(error.contains("at character"), "{expression}: {error}");
            assert!(error.starts_with("invalid compute.expression:"), "{error}");
        }

        let long = "1".repeat(MAX_EXPRESSION_LEN + 1);
        assert!(
            parse(&long)
                .expect_err("too long")
                .to_string()
                .contains("longer than 500")
        );

        let deep = format!(
            "{}1{}",
            "(".repeat(MAX_DEPTH + 1),
            ")".repeat(MAX_DEPTH + 1)
        );
        assert!(
            parse(&deep)
                .expect_err("too deep")
                .to_string()
                .contains("nests deeper")
        );
    }

    #[test]
    fn references_and_rewrite_see_only_identifier_tokens() {
        let expr = parse("days(last_completed_at, today()) + room + title").expect("parses");
        assert_eq!(
            references(&expr),
            BTreeSet::from(["last_completed_at", "room", "title"])
        );

        assert_eq!(
            rewrite(r#"room + room2 + "room""#, "room", "space"),
            Some(r#"space + room2 + "room""#.to_owned())
        );
        assert_eq!(
            rewrite("  room  +  room ", "room", "space"),
            Some("  space  +  space ".to_owned()),
            "whitespace is preserved"
        );
        assert_eq!(rewrite("room + 1", "room", "room"), None);
        assert_eq!(rewrite("room + 1", "other", "space"), None);
        assert_eq!(rewrite("room @", "room", "space"), None, "unlexable source");
        assert_eq!(
            rewrite("round(room, 1)", "round", "x"),
            None,
            "a function name is not a reference"
        );
    }

    /// The error's field, for a compact assertion in the table above.
    trait FieldOf {
        fn field_of(&self) -> Option<&str>;
    }

    impl FieldOf for CoreError {
        fn field_of(&self) -> Option<&str> {
            match self {
                CoreError::ValidationFailed { field, .. } => Some(field),
                _ => None,
            }
        }
    }
}
