import cdk = require('@aws-cdk/cdk');
import { AccountPrincipal, AccountRootPrincipal, Anyone,
  ArnPrincipal, CanonicalUserPrincipal, FederatedPrincipal, IPrincipal, ServicePrincipal } from './principals';
import { mergePrincipal } from './util';

export class PolicyDocument extends cdk.Token {
  private statements = new Array<PolicyStatement>();

  /**
   * Creates a new IAM policy document.
   * @param defaultDocument An IAM policy document to use as an initial
   * policy. All statements of this document will be copied in.
   */
  constructor(private readonly baseDocument?: any) {
    super();
  }

  public resolve(_context: cdk.ResolveContext): any {
    if (this.isEmpty) {
      return undefined;
    }

    const doc = this.baseDocument || { };
    doc.Statement = doc.Statement || [ ];
    doc.Version = doc.Version || '2012-10-17';
    doc.Statement = doc.Statement.concat(this.statements);
    return doc;
  }

  get isEmpty(): boolean {
    return this.statements.length === 0;
  }

  /**
   * The number of statements already added to this policy.
   * Can be used, for example, to generate uniuqe "sid"s within the policy.
   */
  get statementCount(): number {
    return this.statements.length;
  }

  public addStatement(statement: PolicyStatement): PolicyDocument {
    this.statements.push(statement);
    return this;
  }
}

/**
 * Represents a statement in an IAM policy document.
 */
export class PolicyStatement extends cdk.Token {
  private action = new Array<any>();
  private principal: { [key: string]: any[] } = {};
  private resource = new Array<any>();
  private condition: { [key: string]: any } = { };
  private effect?: PolicyStatementEffect;
  private sid?: any;

  constructor(effect: PolicyStatementEffect = PolicyStatementEffect.Allow) {
    super();
    this.effect = effect;
  }

  //
  // Actions
  //

  public addAction(action: string): PolicyStatement {
    this.action.push(action);
    return this;
  }

  public addActions(...actions: string[]): PolicyStatement {
    actions.forEach(action => this.addAction(action));
    return this;
  }

  //
  // Principal
  //

  /**
   * Indicates if this permission has a "Principal" section.
   */
  public get hasPrincipal() {
    return Object.keys(this.principal).length > 0;
  }

  public addPrincipal(principal: IPrincipal): this {
    const fragment = principal.policyFragment;
    mergePrincipal(this.principal, fragment.principalJson);
    this.addConditions(fragment.conditions);
    return this;
  }

  public addAwsPrincipal(arn: string): this {
    return this.addPrincipal(new ArnPrincipal(arn));
  }

  public addAwsAccountPrincipal(accountId: string): this {
    return this.addPrincipal(new AccountPrincipal(accountId));
  }

  public addArnPrincipal(arn: string): this {
    return this.addAwsPrincipal(arn);
  }

  public addServicePrincipal(service: string): this {
    return this.addPrincipal(new ServicePrincipal(service));
  }

  public addFederatedPrincipal(federated: any, conditions: {[key: string]: any}): this {
    return this.addPrincipal(new FederatedPrincipal(federated, conditions));
  }

  public addAccountRootPrincipal(): this {
    return this.addPrincipal(new AccountRootPrincipal());
  }

  public addCanonicalUserPrincipal(canonicalUserId: string): this {
    return this.addPrincipal(new CanonicalUserPrincipal(canonicalUserId));
  }

  public addAnyPrincipal(): this {
    return this.addPrincipal(new Anyone());
  }

  //
  // Resources
  //

  public addResource(arn: string): PolicyStatement {
    this.resource.push(arn);
    return this;
  }

  /**
   * Adds a ``"*"`` resource to this statement.
   */
  public addAllResources(): PolicyStatement {
    return this.addResource('*');
  }

  public addResources(...arns: string[]): PolicyStatement {
    arns.forEach(r => this.addResource(r));
    return this;
  }

  /**
   * Indicates if this permission as at least one resource associated with it.
   */
  public get hasResource() {
    return this.resource && this.resource.length > 0;
  }

  public describe(sid: string): PolicyStatement {
    this.sid = sid;
    return this;
  }

  //
  // Effect
  //

  /**
   * Sets the permission effect to allow access to resources.
   */
  public allow(): PolicyStatement {
    this.effect = PolicyStatementEffect.Allow;
    return this;
  }

  /**
   * Sets the permission effect to deny access to resources.
   */
  public deny(): PolicyStatement {
    this.effect = PolicyStatementEffect.Deny;
    return this;
  }

  //
  // Condition
  //

  /**
   * Add a condition to the Policy
   */
  public addCondition(key: string, value: any): PolicyStatement {
    this.condition[key] = value;
    return this;
  }

  /**
   * Add multiple conditions to the Policy
   */
  public addConditions(conditions: {[key: string]: any}): PolicyStatement {
    Object.keys(conditions).map(key => {
      this.addCondition(key, conditions[key]);
    });
    return this;
  }

  /**
   * Add a condition to the Policy.
   *
   * @deprecated For backwards compatibility. Use addCondition() instead.
   */
  public setCondition(key: string, value: any): PolicyStatement {
    return this.addCondition(key, value);
  }

  public limitToAccount(accountId: string): PolicyStatement {
    return this.addCondition('StringEquals', new cdk.Token(() => {
      return { 'sts:ExternalId': accountId };
    }));
  }

  //
  // Serialization
  //
  public resolve(_context: cdk.ResolveContext): any {
    return this.toJson();
  }

  public toJson(): any {
    return {
      Action: _norm(this.action),
      Condition: _norm(this.condition),
      Effect: _norm(this.effect),
      Principal: _normPrincipal(this.principal),
      Resource: _norm(this.resource),
      Sid: _norm(this.sid),
    };

    function _norm(values: any) {

      if (typeof(values) === 'undefined') {
        return undefined;
      }

      if (Array.isArray(values)) {
        if (!values || values.length === 0) {
          return undefined;
        }

        if (values.length === 1) {
          return values[0];
        }

        return values;
      }

      if (typeof(values) === 'object') {
        if (Object.keys(values).length === 0) {
          return undefined;
        }
      }

      return values;
    }

    function _normPrincipal(principal: { [key: string]: any[] }) {
      const keys = Object.keys(principal);
      if (keys.length === 0) { return undefined; }
      const result: any = {};
      for (const key of keys) {
        const normVal = _norm(principal[key]);
        if (normVal) {
          result[key] = normVal;
        }
      }
      if (Object.keys(result).length === 1 && result.AWS === '*') {
        return '*';
      }
      return result;
    }
  }
}

export enum PolicyStatementEffect {
  Allow = 'Allow',
  Deny = 'Deny',
}
