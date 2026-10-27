#pragma once
#include "BTNode.h"

UCLASS()
class UGuardNode : public UBTNode
{
	GENERATED_BODY()
public:
	TFunction<bool(UBlackboard*)> Condition;

protected:
	virtual EBTNodeStatus OnTick(UBlackboard* Bb) override
	{
		if (Children.Num() == 0) return EBTNodeStatus::Failure;
		if (Condition && !Condition(Bb)) return EBTNodeStatus::Failure;
		return Children[0]->Tick(Bb);
	}
};
